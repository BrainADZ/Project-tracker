# Backend structure

The backend lives in this folder. The HTTP server uses PostgreSQL.

| Folder         | Responsibility                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| `routes/`      | Express HTTP adapter and the shared route registry                                                   |
| `controllers/` | API operations grouped by project, marketing, daily reporting, development reporting and task review |
| `models/`      | PostgreSQL adapter, legacy migration reader and user/project access queries                          |
| `schema/`      | Table definitions and versioned migrations                                                           |
| `services/`    | Business rules, reporting access, work tracking and shared validation                                |
| `seeds/`       | Demo data and one-shot seed commands                                                                 |

`index.js` starts the server. `npm start`, `npm test`, and the seed commands in
the root `package.json` use these paths.

The server requires `DATABASE_URL` and stores project data in PostgreSQL.
`DATA_DIR` holds uploads and the one-time SQLite migration backup. Run
`npm run db:migrate` once to copy an existing `data/projects.db` into an empty
PostgreSQL database; the command checks table counts before committing and
does not delete the source file.
