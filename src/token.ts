import MSGraph from './ms-graph';
import { parseJwt } from './utils';

MSGraph.login()
  .then((token) => {
    const decoded = parseJwt(token);
    console.log({ token, decoded });
  })
  .catch(console.error);
