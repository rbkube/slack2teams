import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import { SLACK_EXPORT_PATH } from './constants';

const preprocess = (messages) => {
  const msgDict = _.keyBy(messages, (msg) => `${msg.user}:${msg.ts}`);
  messages.forEach((message) => {
    if (_.has(message, 'replies')) {
      message.replies.forEach((reply) => {
        if (msgDict[`${reply.user}:${reply.ts}`])
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
  const channels = JSON.parse(
    fs.readFileSync(path.join(SLACK_EXPORT_PATH, 'channels.json'), 'utf-8')
  );

  const [active, archived] = _.partition(channels, (channel) => !channel.is_archived);

  const SUPPORTED_MSG_TYPES = ['tombstone', 'bot_message', 'undefined'];

  const messages = _(active)
    .flatMap((channel) => {
      const channelDir = path.join(SLACK_EXPORT_PATH, channel.name);
      const files = fs.readdirSync(channelDir);
      return _.flatMap(files, (file) => {
        const filepath = path.join(channelDir, file);
        const messages = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        return _(messages)
          .map((message) => ({
            ...message,
            channel: channel.name,
          }))
          .value();
      });
    })
    .orderBy((msg) => +msg.ts, 'asc')
    .value();

  const supported = _(messages)
    .filter((msg) => !msg.subtype || SUPPORTED_MSG_TYPES.includes(msg.subtype))
    .groupBy('subtype')
    .reduce((acc, v) => [...acc, ...v], []);

  const grouped = _.groupBy(supported, 'channel');

  const test = _.map(grouped, (msgs, channel) => {
    // const n = msgs.length > 5000 ? msgs.length : 0;
    return { channel, n_msg: msgs.length };
  });
  console.log(JSON.stringify(_.sortBy(test, 'n_msg')));
  console.log(_.sum(_.values(test)));
};

main();
