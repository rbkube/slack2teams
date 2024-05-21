import fs from 'fs';
import cliload from 'loading-cli';
import _ from 'lodash';
import mime from 'mime-types';
import path from 'path';
import { SLACK_EXPORT_PATH, STATE_DIRECTORY } from './constants';
import MSGraph from './ms-graph';
import { downloadFile, sleep } from './utils';

type DownloadFile = {
  error?: string;
  id: string;
  url: string;
  mimetype: string;
  name: string;
  permalink: string;
  extension: string | false;
  width: number;
  height: number;
  mode: 'hosted' | 'email' | 'external';
  filetype: string;
  filepath: string;
};

const writeFilesToDisk = (files: DownloadFile[]) => {
  const load = cliload('Starting files download').start();

  let number = 0;
  let success = 0;
  const total = files.length;

  const promises = _.map(files, (file) => {
    if (file.error) {
      return () => {
        number++;
        load.warn(`${number}/${total} - Skipped ${file.name}: ${file.error}`);
        return Promise.resolve();
      };
    }
    const filepath = file.filepath;
    return () => {
      number++;
      success++;
      load.start(`${number}/${total} - Downloading ${path.basename(filepath)}`);
      if (fs.existsSync(filepath)) {
        load.info(`File already exists: ${path.basename(filepath)}`);
        return Promise.resolve();
      }
      const res = downloadFile(file.url, filepath).catch((err) => {
        load.fail(`Failed to download ${file.url}`);
        console.error(err);
      });
      return res;
    };
  });

  const res = _.reduce(
    promises,
    (acc, next) => {
      return acc.then(() => sleep(50)).then(next);
    },
    Promise.resolve()
  );

  return res.then(() => {
    load.succeed(`Downloaded ${success}/${total} files successfully.`);
  });
};

const main = async () => {
  console.log('Logging in...');
  await MSGraph.login();
  console.log('Logged in successfully!');

  const channels = JSON.parse(
    fs.readFileSync(path.join(STATE_DIRECTORY, 'channels.json'), 'utf-8')
  );
  const messages = _.flatMap(channels, (channel) => {
    const channelDir = path.join(SLACK_EXPORT_PATH, channel.slackName);
    const files = fs.readdirSync(channelDir);
    return _.flatMap(files, (file) => {
      const filepath = path.join(channelDir, file);
      const messages = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      return _.map(messages, (message) => ({
        ...message,
        channel: channel.slackId,
      }));
    });
  });

  const filesDir = path.join(STATE_DIRECTORY, 'files');
  if (!fs.existsSync(filesDir)) {
    fs.mkdirSync(path.join(filesDir), { recursive: true });
  }

  const filesToDownload: DownloadFile[] = _.filter(messages, 'files').flatMap((message) => {
    return _.map(message.files, (file) => {
      let filepath = path.join(filesDir, `${file.id}.${file.filetype}`);
      let error;
      if (file.mimetype === 'application/octet-stream' || !file.mimetype) {
        error = 'Unknown file type, file is probably corrupted.';
      } else if (file.mode === 'external') {
        error = 'File hosted on an external service';
      } else if (file.mode !== 'hosted') {
        error =
          'Only hosted files are supported, canvases, snippets, and other files are not supported.';
      }
      return {
        id: file.id,
        channelId: message.channel,
        url: file.url_private_download,
        mimetype: file.mimetype,
        name: file.name,
        permalink: file.permalink_public,
        extension: mime.extension(file.mimetype),
        width: file.original_w,
        height: file.original_h,
        mode: file.mode,
        filetype: file.filetype,
        filepath: error ? null : filepath,
        error,
      };
    });
  });

  const unique = _.uniqBy(filesToDownload, 'id');

  console.log(`${unique.length} files found in the slack export.`);
  const grouped = _.groupBy(unique, 'error');
  const { undefined: ok, ...rest } = grouped;
  console.log(`${ok.length} will be downloaded.`);
  _.forEach(rest, (files, error) => console.log(`${files.length} files skipped: ${error}`));
  // console.log(`${} files are hosted on slack.`);
  fs.writeFileSync(path.join(STATE_DIRECTORY, 'files.json'), JSON.stringify(ok, null, 2));
  console.log('Files metadata saved to state/files.json');
  console.log('Downloading files...');
  //   console.table(filesToDownload);
  await writeFilesToDisk(ok);
};

main();
