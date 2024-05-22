import path from 'path';
import { STATE_DIRECTORY } from './constants';
import fs from 'fs';
import { generateThumbnailBase64 } from './utils';
import cliload from 'loading-cli';

const main = async () => {
  const files = JSON.parse(fs.readFileSync(path.join(STATE_DIRECTORY, 'files.json'), 'utf-8'));
  const filtered = files.filter(
    (file) => !file.error && file.mimetype.includes('image') && !file.mimetype.includes('heic')
  );
  const thumbs = [];
  const load = cliload('Generating thumbnails').start();
  let number = 0;
  for (const meta of filtered) {
    number++;
    load.start(`${number}/${filtered.length} - Generating thumbnail...`);
    try {
      const thumb = await generateThumbnailBase64(meta.filepath);
      thumbs.push({
        id: meta.id,
        thumb,
      });
    } catch (error) {
      load.warn(`Failed to generate thumbnail for ${meta.name}`);
    }
  }
  load.succeed(`Generated thumbnails for ${number}/${filtered.length} files.`);
  fs.writeFileSync(path.join(STATE_DIRECTORY, 'thumbs.json'), JSON.stringify(thumbs));
};

main();
