import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import { SLACK_EXPORT_PATH, STATE_DIRECTORY } from './constants';
import cliload from 'loading-cli';
import MSGraph from './ms-graph';
import { sleep } from './utils';

type ChannelResult = {
  channelId: string;
  channelName: string;
  teamId: string;
};

type UserResult = {
  id: string;
  displayName: string;
};

type ProcessedMessage = {
  createdDateTime: string;
  id: string;
  from: {
    user: UserResult;
  };
  body: {
    contentType: string;
    content: string;
  };
  attachments: {
    id: string;
    contentUrl: string;
    name: string;
  }[];
  mentions: Mention[];
  webUrl?: string;
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
  getMessage: (id: string) => ProcessedMessage;
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
      console.log(`Unhandled text object type: ${textObj.type}`);
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
      console.log(`Unhandled block type: ${block.type}`);
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
  const { blocks, attachments, files } = message;
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
    const message = mappers.getMessage(quote);
    if (!message) {
      html += `<blockquote>Deleted message</blockquote>`;
      return;
    }
    html += `<blockquote>${message.from.user.displayName}<br />${message.body.content}<br /><a href="${message.webUrl}">View original</a></blockquote>`;
    MSattachments.push(...message.attachments);
  });
  let attachmentsHtml = '';
  files?.forEach((file) => {
    // if (isExternalFile(file)) {
    //   const url = file.url_private;
    //   html += `<a href="${url}">${url}</a>`;
    // } else
    if (isInternalFile(file)) {
      const obj = mappers.fromSlackFileId(file.id);
      if (!obj) return;
      const attachement = {
        ...obj,
      };
      // if (attachement.contentType.startsWith('image')) {
      //   html += `<a href=${attachement.contentUrl}><img src="${attachement.contentUrl}" alt="${attachement.name}" /></a>`;
      // } else {
      MSattachments.push({
        ...attachement,
        contentType: 'reference',
      });
      attachmentsHtml += `<attachment id="${attachement.id}"></attachment>`;
      // }
    }
  });
  html += attachmentsHtml;
  html += '</div>';
  const channel = mappers.fromSlackChannelId(message.channel);
  let route = `teams/${encodeURIComponent(channel.teamId)}/channels/${encodeURIComponent(
    channel.channelId
  )}/messages`;
  if (message.replyTo) {
    route += `/${encodeURIComponent(mappers.getMessage(message.replyTo).id)}/replies`;
  }
  return {
    route,
    payload: {
      createdDateTime: new Date(Number(message.ts) * 1000).toISOString(),
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

const preprocess = (messages) => {
  const msgDict = _.keyBy(messages, (msg) => `${msg.user}:${msg.ts}`);
  //   console.log(msgDict);
  messages.forEach((message) => {
    if (_.has(message, 'replies')) {
      message.replies.forEach((reply) => {
        msgDict[`${reply.user}:${reply.ts}`].replyTo = `${message.user}:${message.ts}`;
      });
    }
    if (_.has(message, 'attachments')) {
      message.attachments.forEach((attachment) => {
        if (_.has(attachment, 'message_blocks')) {
          if (!msgDict[`${message.user}:${message.ts}`].quotes) {
            msgDict[`${message.user}:${message.ts}`].quotes = [];
          }
          msgDict[`${message.user}:${message.ts}`].quotes.push(
            `${attachment.author_id}:${attachment.ts}`
          );
        }
      });
    }
  });
  return _.values(msgDict);
};

const main = async () => {
  const usersState = JSON.parse(fs.readFileSync(path.join(STATE_DIRECTORY, 'users.json'), 'utf-8'));

  const defaultUser = usersState.default;
  const users = usersState.users;

  const channels = JSON.parse(
    fs.readFileSync(path.join(STATE_DIRECTORY, 'channels.json'), 'utf-8')
  );

  const files = JSON.parse(
    fs.readFileSync(path.join(STATE_DIRECTORY, 'files-uploaded.json'), 'utf-8')
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
              (!msg.subtype || msg.subtype === 'thread_broadcast' || msg.subtype === 'bot_message')
          )
          .value();
      });
    })
    .orderBy((msg) => +msg.ts, 'asc')
    .value();

  const preprocessed = _.orderBy(preprocess(messages), 'ts', 'asc');

  const processed = {};

  const mappers: Mappers = {
    fromSlackChannelId: (id) => {
      const channel = channels.find((channel) => channel.slackId === id);
      return {
        channelId: channel.channelId,
        channelName: channel.slackName,
        teamId: channel.teamId,
      };
    },
    fromSlackUserId: (id) => {
      const user = users.find((user) => user.slackId === id);
      if (!user) return { id: defaultUser.entraId, displayName: defaultUser.displayName };
      return { id: user.entraId, displayName: user.displayName };
    },
    fromSlackFileId: (id) => {
      const file = files.find((file) => file.slackId === id);
      if (!file) return null;
      return {
        id: file.id,
        contentUrl: file.contentUrl,
        name: file.name,
        contentType: 'reference',
      };
    },
    getMessage: (id: string) => {
      return processed[id];
    },
  };

  console.log('Total messages to be imported:', preprocessed.length);
  console.log('Total messages in slack export:', messages.length);

  const load = cliload('Importing messages to MS teams...').start();
  let number = 0;

  await MSGraph.login();
  for (const pre of preprocessed) {
    number++;
    const msg = slackBlocksToHtml(pre, mappers);
    load.start(`Importing message ${number}/${preprocessed.length}...`);
    try {
      const id = new Date(msg.payload.createdDateTime).getTime();
      let res = await MSGraph.fetch(msg.route, {
        method: 'POST',
        body: JSON.stringify(msg.payload),
      })
        .then((res) => res.json())
        .catch((e) => {
          if (e?.response?.error?.code !== 'Conflict') console.dir(e, { depth: null });
          return null;
        });
      if (!res) res = await MSGraph.fetch(`${msg.route}/${id}`, {}).then((res) => res.json());
      //   console.log(res);
      processed[pre.user + ':' + pre.ts] = res;
      await sleep(200);
    } catch (e) {
      load.fail(`Message ${number}/${preprocessed.length} failed to import.`);
      console.dir(e, { depth: null });
    }
  }
  load.succeed('All messages imported successfully.');
};

main();
