import cliload from 'loading-cli';
import path from 'path';
import { STATE_DIRECTORY } from './constants';
import MSGraph from './ms-graph';
import { PersistentQueue, ShutdownManager } from './queue';
import { formatTime, sleep } from './utils';

const main = async () => {
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

  while (parents.length()) {
    const msgs = parents.dequeue(5);
    number += msgs.length;
    const start = Date.now();
    const average = totalTime / number;
    load.start(
      `Importing message ${number}/${totalLength}... | ${formatTime(
        average * (totalLength - number)
      )} remaining`
    );
    const requests = msgs.map((msg) =>
      MSGraph.fetch(msg.route, msg.init).then((res) => res.json())
    );
    try {
      await Promise.all(requests);
      const now = Date.now();
      totalTime += now - start;
      const time2sleep = now - start < 1000 ? 1000 - (now - start) : 0;
      await sleep(time2sleep);
    } catch (e) {
      load.fail(`Message ${number}/${totalLength} failed to import.`);
      console.dir(e, { depth: null });
    }
  }
  load.succeed('All parent messages imported successfully.');

  while (children.length() > 0) {
    const msgs = children.dequeue(5);
    number += msgs.length;
    const start = Date.now();
    const average = totalTime / number;
    load.start(
      `Importing message ${number}/${totalLength}... | ${formatTime(
        average * (totalLength - number)
      )} remaining`
    );
    const requests = msgs.map((msg) =>
      MSGraph.fetch(msg.route, msg.init).then((res) => res.json())
    );
    try {
      await Promise.all(requests);
      const now = Date.now();
      totalTime += now - start;
      const time2sleep = now - start < 1000 ? 1000 - (now - start) : 0;
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
