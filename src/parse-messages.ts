import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import { SLACK_EXPORT_PATH, STATE_DIRECTORY } from './constants';
import { PersistentQueue, ShutdownManager } from './queue';
import { ts2ISO, ts2ms } from './utils';

type ChannelResult = {
  channelId?: string;
  channelName: string;
  teamId?: string;
};

type UserResult = {
  id: string;
  displayName: string;
};

type Mappers = {
  fromSlackUserId: (id: string) => UserResult;
  fromSlackChannelId: (id: string) => ChannelResult;
  fromSlackFileId: (id: string) => {
    id: string;
    contentUrl: string;
    name: string;
    contentType: string;
  };
};

const addStyle = (styleObject, text) => {
  if (!styleObject) {
    return text;
  }
  const { bold, italic, strike } = styleObject;
  let style = '';
  if (bold) {
    style += '<strong>';
  }
  if (italic) {
    style += '<em>';
  }
  if (strike) {
    style += '<strike>';
  }
  style += text;
  if (strike) {
    style += '</strike>';
  }
  if (italic) {
    style += '</em>';
  }
  if (bold) {
    style += '</strong>';
  }
  return style;
};

type Mention = {
  id: number;
  mentionText: string;
  mentioned: {
    user: {
      displayName: string;
      id: string;
      userIdentityType: string;
    };
  };
};

const parseTextObject = (textObj: any, mappers: Mappers, mentions: Mention[]) => {
  let text = '';
  switch (textObj.type) {
    case 'text':
      text = `${addStyle(textObj.style, textObj.text).replace(/\n/g, '<br />')}`;
      break;
    case 'link':
      text = `<a href="${textObj.url}"">${addStyle(
        textObj.style,
        textObj.text ?? textObj.url
      )}</a>`;
      break;
    case 'emoji':
      text = textObj.unicode ? `&#x${textObj.unicode.split('-')[0]};` : '';
      break;
    case 'user':
      const { id: userId, displayName } = mappers.fromSlackUserId(textObj.user_id);
      const mentionId = mentions.length;
      text = `<at id="${mentionId}">${displayName}</at>`;
      mentions.push({
        id: mentionId,
        mentionText: displayName,
        mentioned: {
          user: {
            displayName,
            id: userId,
            userIdentityType: 'aadUser',
          },
        },
      });
      break;
    case 'channel':
      const { channelName } = mappers.fromSlackChannelId(textObj.channel_id);
      text = `<strong>@${channelName}</strong>`;
      break;
    case 'broadcast':
      text = `<strong>@${textObj.range}</strong>`;
      break;
    case 'usergroup':
      text = `<strong>@deleted-group</strong>`;
      break;
    default:
      // console.log(`Unhandled text object type: ${textObj.type}`);
      break;
  }
  return text;
};

const parseRichTextList = (list, mappers: Mappers, mentions: Mention[]) => {
  const style = list.style === 'ordered' ? 'ol' : 'ul';
  let items = '';
  list.elements.forEach((element) => {
    items += `<li>${parseRichTextElement(element, mappers, mentions)}</li>`;
  });
  return `<${style}>${items}</${style}>`;
};

const parseRichTextElement = (element, mappers: Mappers, mentions: Mention[]) => {
  if (element.type === 'rich_text_section') {
    return element.elements.map((e) => parseRichTextElement(e, mappers, mentions)).join('');
  } else if (element.type === 'rich_text_list') {
    return parseRichTextList(element, mappers, mentions);
  } else if (element.type === 'rich_text_preformatted') {
    return `<pre>${element.text}</pre>`;
  } else if (element.type === 'rich_text_quote') {
    return `<blockquote>${element.text}</blockquote>`;
  } else {
    return parseTextObject(element, mappers, mentions);
  }
};

const parseBlock = (block, mappers: Mappers, mentions: Mention[]) => {
  let content = '';

  switch (block.type) {
    case 'rich_text':
      block.elements.forEach((element) => {
        content += parseRichTextElement(element, mappers, mentions);
      });
      break;
    case 'image':
      content += `<img src="${block.image_url}" alt="${block.alt_text}" />`;
      break;
    case 'divider':
      content += '<hr />';
      break;
    case 'section':
      break;
    case 'context':
      break;
    case 'header':
      if (block.text) {
        content += parseRichTextElement(block.text, mappers, mentions);
      }
      break;
    default:
    // console.log(`Unhandled block type: ${block.type}`);
  }
  return content;
};

const isMessageRef = (attachment) => {
  return _.has(attachment, 'message_blocks');
};

const isExternalFile = (file) => {
  return file.mode === 'external';
};

const isInternalFile = (file) => {
  return file.mode === 'hosted';
};

const isEmailFile = (file) => {
  return file.mode === 'email';
};

const slackBlocksToHtml = (message, mappers: Mappers) => {
  const { blocks, files } = message;
  const MSattachments = [];
  const mentions: Mention[] = [];
  let html = '<div>';
  if (!message.blocks) {
    html += `${message.text}`;
  } else {
    blocks.forEach((block) => {
      html += parseBlock(block, mappers, mentions);
    });
  }
  message.quotes?.forEach((quote) => {
    const message = slackBlocksToHtml(quote.message, mappers);
    html += `<blockquote><strong>${quote.authorName}</strong><br /><br />${message.payload.body.content}</blockquote>`;
    MSattachments.push(...message.payload.attachments);
    mentions.push(...message.payload.mentions);
  });
  let attachmentsHtml = '';
  files?.forEach((file) => {
    if (isInternalFile(file)) {
      const obj = mappers.fromSlackFileId(file.id);
      if (!obj) return;
      const attachment = {
        ...obj,
      };
      MSattachments.push({
        ...attachment,
        contentType: 'reference',
      });
      attachmentsHtml += `<attachment id="${attachment.id}"></attachment>`;
    }
  });
  html += attachmentsHtml;
  html += '</div>';
  const channel = mappers.fromSlackChannelId(message.channel);
  let route = `teams/${encodeURIComponent(channel.teamId)}/channels/${encodeURIComponent(
    channel.channelId
  )}/messages`;
  if (message.replyTo) {
    const ts = message.replyTo.split(':')[1];
    route += `/${encodeURIComponent(ts)}/replies`;
  }
  return {
    route,
    payload: {
      createdDateTime: ts2ISO(message.ts),
      // ts: message.ts,
      from: {
        user: { ...mappers.fromSlackUserId(message.user), userIdentityType: 'aadUser' },
      },
      body: {
        contentType: 'html',
        content: html,
      },
      attachments: MSattachments,
      mentions,
    },
  };
};

const deduplicateTimestamps = (messages) => {
  const grouped = _.groupBy(messages, 'ts');
  const duplicates = _.filter(grouped, (v) => v.length > 1);
  if (duplicates.length === 0) return messages;
  else {
    const deduplicated = _.flatMap(grouped, (msgs) =>
      _.map(msgs, (msg, i) => ({ ...msg, ts: msg.ts + i }))
    );
    return deduplicateTimestamps(deduplicated);
  }
};

const preprocess = (messages) => {
  const converted = _.map(messages, (msg) => ({ ...msg, ts: ts2ms(msg.ts) }));
  const deduplicated = deduplicateTimestamps(converted);

  const msgDict = _.keyBy(deduplicated, (msg) => `${msg.user}:${msg.ts}`);
  deduplicated.forEach((message) => {
    if (_.has(message, 'replies')) {
      message.replies.forEach((reply) => {
        if (msgDict[`${reply.user}:${reply.ts}`])
          msgDict[`${reply.user}:${reply.ts}`].replyTo = `${message.user}:${message.ts}`;
      });
    }
    if (_.has(message, 'attachments')) {
      message.attachments.forEach((attachment) => {
        if (_.has(attachment, 'message_blocks[0].message')) {
          if (!msgDict[`${message.user}:${message.ts}`].quotes) {
            msgDict[`${message.user}:${message.ts}`].quotes = [];
          }
          msgDict[`${message.user}:${message.ts}`].quotes.push({
            authorName: attachment.author_name,
            message: {
              ...attachment.message_blocks[0].message,
              user: attachment.author_id,
              ts: attachment.ts,
            },
          });
        }
      });
    }
  });
  return _.values(msgDict);
};

const main = async () => {
  const usersState = JSON.parse(fs.readFileSync(path.join(STATE_DIRECTORY, 'users.json'), 'utf-8'));

  const defaultUser = usersState.default;
  const users = _.keyBy(usersState.users, 'slackId');

  const channels = _.keyBy(
    JSON.parse(fs.readFileSync(path.join(STATE_DIRECTORY, 'channels.json'), 'utf-8')),
    'slackId'
  );

  const files = _.keyBy(
    JSON.parse(fs.readFileSync(path.join(STATE_DIRECTORY, 'files-uploaded.json'), 'utf-8')),
    'slackId'
  );

  const messages = _(channels)
    .flatMap((channel) => {
      const channelDir = path.join(SLACK_EXPORT_PATH, channel.slackName);
      const files = fs.readdirSync(channelDir);
      return _.flatMap(files, (file) => {
        const filepath = path.join(channelDir, file);
        const messages = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        return _(messages)
          .map((message) => ({
            ...message,
            channel: channel.slackId,
          }))
          .filter(
            (msg) =>
              msg.type === 'message' &&
              (!msg.subtype || msg.subtype === 'thread_broadcast' || msg.subtype === 'bot')
          )
          .value();
      });
    })
    .orderBy((msg) => +msg.ts, 'asc')
    .value();

  const preprocessed = _.orderBy(preprocess(messages), 'ts', 'asc');

  const mappers: Mappers = {
    fromSlackChannelId: (id) => {
      try {
        const channel = channels[id];
        return {
          channelId: channel.channelId,
          channelName: channel.slackName,
          teamId: channel.teamId,
        };
      } catch (e) {
        return {
          channelName: 'deleted-channel',
        };
      }
    },
    fromSlackUserId: (id) => {
      const user = users[id];
      if (!user) return { id: defaultUser.entraId, displayName: defaultUser.displayName };
      return { id: user.entraId, displayName: user.displayName };
    },
    fromSlackFileId: (id) => {
      const file = files[id];

      if (!file) return null;
      return {
        id: file.id,
        contentUrl: file.contentUrl,
        name: file.name,
        contentType: 'reference',
      };
    },
  };

  ShutdownManager.setup();

  // const queues: Record<string, { parents: PersistentQueue; children: PersistentQueue }> = _(
  //   channels
  // ).reduce(async (acc, channel) => {
  //   const parents = await new PersistentQueue(
  //     path.join(STATE_DIRECTORY, `queues/parents/${channel.slackId}.json`)
  //   ).init();
  //   const children = await new PersistentQueue(
  //     path.join(STATE_DIRECTORY, `queues/children/${channel.slackId}.json`)
  //   ).init();
  //   ShutdownManager.registerQueue(parents);
  //   ShutdownManager.registerQueue(children);
  //   return {
  //     ...acc,
  //     [channel.slackId]: {
  //       parents,
  //       children,
  //     },
  //   };
  // }, {});

  const parents = await new PersistentQueue(
    path.join(STATE_DIRECTORY, 'queues/parents.json')
  ).init();
  const children = await new PersistentQueue(
    path.join(STATE_DIRECTORY, 'queues/children.json')
  ).init();

  ShutdownManager.registerQueue(parents);
  ShutdownManager.registerQueue(children);

  for (const pre of preprocessed) {
    const msg = slackBlocksToHtml(pre, mappers);
    const channelId = pre.channel;
    if (pre.replyTo) {
      children.enqueue({
        route: msg.route,
        init: {
          method: 'POST',
          body: JSON.stringify(msg.payload),
          retries: 1,
        },
      });
    } else {
      parents.enqueue({
        route: msg.route,
        init: {
          method: 'POST',
          body: JSON.stringify(msg.payload),
          retries: 1,
        },
      });
    }
  }

  console.log('Total messages to be imported:', preprocessed.length);
  console.log('Total messages in slack export:', messages.length);

  ShutdownManager.shutdown();

  // const load = cliload('Importing messages to MS teams...').start();
  // let number = 0;

  // await MSGraph.login();
  // let totalTime = 0;
  // for (const pre of preprocessed) {
  //   number++;
  //   const start = Date.now();
  //   const average = totalTime / number;
  //   const msg = slackBlocksToHtml(pre, mappers);
  //   load.start(
  //     `Importing message ${number}/${preprocessed.length}... | ${formatTime(
  //       average * (preprocessed.length - number)
  //     )} remaining`
  //   );
  //   try {
  //     let res = await MSGraph.fetch(msg.route, {
  //       method: 'POST',
  //       body: JSON.stringify(msg.payload),
  //       retries: 1,
  //     }).then((res) => res.json());
  //     processed[pre.user + ':' + pre.ts] = res;
  //     const now = Date.now();
  //     const time2sleep = now - start < 200 ? 200 - (now - start) : 0;
  //     await sleep(time2sleep);
  //   } catch (e) {
  //     load.fail(`Message ${number}/${preprocessed.length} failed to import.`);
  //     console.dir(e, { depth: null });
  //   }
  // }
  // load.succeed('All messages imported successfully.');
};

main();
