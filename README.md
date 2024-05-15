# slack2teams

Slack2Teams migration toolbox

## Available commands

| Command                            | Description                                                                                                                                                                                                                                                                              | State file output                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `pnpm migrate-users`               | Creates or map slack users to existing or newly created users. Uses a csv file with two columns: `slack`, `entra`, that matches slack emails to entra emails. Users not mapped in this file will be created in Entra with `Guest` role, and `#MIG#` marker in their `userPrincipalName`. | `state/users.json`                  |
| `pnpm migrate-channels $TEAM_NAME` | Creates a new team with $TEAM_NAME in migration mode, also creates all the channels from your slack export in this team in migration mode.                                                                                                                                               | `state/channels.json`               |
| `pnpm download-files`              | Download all the files from your slack export on your local machine. Saves the files metadata.                                                                                                                                                                                           | `state/files.json` `state/files/**` |
| `pnpm sharepoint`                  | Provision sharepoint folders for all the channels of your team.                                                                                                                                                                                                                          | `state/channel-folders.json`        |
| `pnpm migrate-files`               | Uploads all the files from your local machine to relevant sharepoint folders.                                                                                                                                                                                                            | `state/files-uploaded.json`         |
| `pnpm migrate-messages`            | Upload all the messages from your slack export to the relevant channels, also properly links file attachments in messages.                                                                                                                                                               |                                     |
| `pnpm complete-migration`          | Put your team and channels out of migration mode. After this step users can be added to the team.                                                                                                                                                                                        |                                     |

## Required permissions for entra application:

Admin consent must be granted for those permissions.

| Permission name                        | Type        | Description                                                                    |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `Channel.Create`                       | Application | Create channels                                                                |
| `Channel.ReadBasic.All`                | Application | Read the names and descriptions of all channels                                |
| `ChannelMessage.Read.All`              | Application | Read all channel messages                                                      |
| `Files.ReadWrite.All`                  | Application | Read and write files in all site collections                                   |
| `Team.Create`                          | Application | Create teams                                                                   |
| `TeamMember.ReadWrite.All`             | Application | Add and remove members from all teams                                          |
| `TeamMember.ReadWriteNonOwnerRole.All` | Application | Add and remove members with non-owner role for all teams                       |
| `Teamwork.Migrate.All`                 | Application | Create chat and channel messages with anyone's identity and with any timestamp |
| `User.ReadWrite.All`                   | Application | Read and write all users' full profiles                                        |
| `UserTeamwork.Read.All`                | Application | Read all user teamwork settings                                                |
