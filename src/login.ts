import { ConfidentialClientApplication, Configuration } from '@azure/msal-node';
import { spawnSync } from 'child_process';
import * as http from 'http';
import { ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET, ENTRA_TENANT_ID } from './constants';
import { sleep } from './utils';

const config: Configuration = {
  auth: {
    clientId: ENTRA_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${ENTRA_TENANT_ID}`,
    clientSecret: ENTRA_CLIENT_SECRET,
  },
};
const clientApp = new ConfidentialClientApplication(config);
const port = 3000;
const redirectUri = `http://localhost:${port}/redirect`;

// Function to open a URL in the default browser
function open(url) {
  switch (process.platform) {
    case 'darwin': // macOS
      spawnSync('open', [url]);
      break;
    case 'win32': // Windows
      spawnSync('start', [url]);
      break;
    default: // Linux
      spawnSync('xdg-open', [url]);
      break;
  }
}

const State = <T extends { [k: string]: any }>(init: T, onChange: (v: T) => void) => {
  let validator = {
    set: function (target: T, key: string, value: any) {
      (target as any)[key] = value;
      onChange(target);
      return true;
    },
  };
  return new Proxy<T>(init, validator);
};

const signInState = State<{ accessToken: string | null; finished: boolean }>(
  { accessToken: null, finished: false },
  (v) => {
    if (v.finished) server.close();
  }
);

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad Request: Missing URL');
    return;
  }

  const urlParts = new URL(req.url, `http://localhost:${port}`);
  if (urlParts.pathname === '/redirect') {
    const code = urlParts.searchParams.get('code');
    if (code) {
      const tokenRequest = {
        code,
        scopes: ['https://graph.microsoft.com/.default'],
        redirectUri: redirectUri,
      };

      try {
        const response = await clientApp.acquireTokenByCode(tokenRequest);
        signInState.accessToken = response.accessToken;
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Login successful! You can close this page.');
      } catch (error) {
        console.error(error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error acquiring token');
      }
    } else {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request: Missing code');
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
  signInState.finished = true;
});

const getSignInURL = async () => {
  const authCodeUrlParameters = {
    scopes: ['https://graph.microsoft.com/.default'],
    redirectUri: redirectUri,
  };

  try {
    const url = await clientApp.getAuthCodeUrl(authCodeUrlParameters);
    return url;
  } catch (error) {
    console.error(error);
  }
};

export const login_old = async () => {
  const signInUrl = await getSignInURL();
  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
    console.log('Please login in your web browser.');
    open(signInUrl);
  });
  while (!signInState.finished) {
    await sleep(3000);
  }
  return signInState.accessToken;
};

export const login = async () => {
  return (
    await clientApp.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    })
  ).accessToken;
};
