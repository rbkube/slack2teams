import path from 'path';
import { MS_GRAPH_BASE, MS_GRAPH_BETA } from './constants';
import { login } from './login';
import { fetchWithRetry, isExpired } from './utils';

export interface TeamUserDTO {
  '@odata.type': '#microsoft.graph.aadUserConversationMember';
  roles?: string[];
  'user@odata.bind': string;
}

class GraphClient {
  private baseUrl: string;
  private accessToken: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  login = async () => {
    const token = await login();
    this.accessToken = token;
    return token;
  };

  fetch = async (
    route: string,
    {
      params = {},
      body = null,
      method = 'GET',
      headers = {},
    }: {
      params?: Record<string, string>;
      body?: any;
      method?: string;
      headers?: Record<string, string>;
    }
  ) => {
    if (!this.accessToken || isExpired(this.accessToken)) await this.login();
    const url = new URL(path.join(this.baseUrl, route));
    url.search = new URLSearchParams(params).toString();
    headers.Authorization = `Bearer ${this.accessToken}`;
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    return fetchWithRetry(url, { headers, method, body });
  };

  createOrGetUser = async (user: {
    entraEmail: string;
    displayName: string;
    mail?: string;
    userType: string;
  }) => {
    try {
      const res = await this.fetch('/users', {
        params: { $filter: `userPrincipalName eq '${user.entraEmail}'` },
      });
      const data = await res.json();
      if (data.value.length) return data.value[0];
      return this.fetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          accountEnabled: true,
          displayName: user.displayName,
          userPrincipalName: user.entraEmail,
          mailNickname: user.entraEmail.split('@')[0],
          mail: user.mail,
          userType: user.userType,
          passwordProfile: {
            forceChangePasswordNextSignIn: true,
            password: 'fh3ej@ak7f+dysz5g7sz-g5iA',
          },
        }),
      }).then((res) => res.json());
    } catch (e) {
      console.error(e);
    }
  };

  createTeam = async (name: string, description: string, createdDateTime: string) => {
    try {
      const team = {
        '@microsoft.graph.teamCreationMode': 'migration',
        'template@odata.bind': "https://graph.microsoft.com/v1.0/teamsTemplates('standard')",
        displayName: name,
        description: description,
        createdDateTime,
      };
      return this.fetch('/teams', {
        method: 'POST',
        body: JSON.stringify(team),
      }).then((res) => {
        const teamIdRegex = /teams\('([^']+)'\)/;
        const locationHeader = res.headers.get('location');
        const match = teamIdRegex.exec(locationHeader);
        if (match) {
          return { id: match[1] };
        }
      });
    } catch (e) {
      console.error(e);
    }
  };
}

const MSGraph = new GraphClient(MS_GRAPH_BASE);
export const MSGraphBeta = new GraphClient(MS_GRAPH_BETA);

export default MSGraph;
