import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import { SLACK_EXPORT_PATH, STATE_DIRECTORY } from './constants';
import { PersistentQueue, ShutdownManager } from './queue';
import cliload from 'loading-cli';
import MSGraph from './ms-graph';
import { queue } from 'sharp';
import { formatTime, sleep } from './utils';

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

  const load = cliload('Importing messages to MS teams...').start();

  await MSGraph.login();
  let totalTime = 0;
  let number = 0;
  const totalLength = parents.length() + children.length();
  while (parents.length() + children.length() > 0) {
    number++;
    const start = Date.now();
    const average = totalTime / number;
    load.start(
      `Importing message ${number}/${totalLength}... | ${formatTime(
        average * (totalLength - number)
      )} remaining`
    );
    const msg = parents.length() > 0 ? await parents.dequeue() : await children.dequeue();
    try {
      let res = await MSGraph.fetch(msg.route, msg.init).then((res) => res.json());
      const now = Date.now();
      const time2sleep = now - start < 200 ? 200 - (now - start) : 0;
      await sleep(time2sleep);
    } catch (e) {
      load.fail(`Message ${number}/${totalLength} failed to import.`);
      console.dir(e, { depth: null });
    }
  }
  load.succeed('All messages imported successfully.');
  ShutdownManager.shutdown();
};

main();
