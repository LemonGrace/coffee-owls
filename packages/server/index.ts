import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createClientAndConnect } from './db';
import { dbConnect } from './init';
import { createUser, getUserById } from './controllers/user.controller';
import { mockUser } from './mocks';
import { router } from './routes';

dotenv.config();

import express, { Request as ExpressRequest } from 'express';
import path from 'path';

import fs from 'fs/promises';
import { createServer as createViteServer, ViteDevServer } from 'vite';
import serialize from 'serialize-javascript';

const port = Number(process.env.SERVER_PORT) || 3001;

const isDev = process.env.NODE_ENV === 'development';
/**
 * dirname dev coffee-owls/packages/server
 * dirname prod coffee-owls/packages/server/dist
 * */
const clientPath = path.join(__dirname, `${isDev ? '../' : '../../'}`, 'client');

async function createServer() {
  await createClientAndConnect();

  dbConnect().then(async () => {
    /* Проверка на наличие пользователя в базе */
    try {
      const currentUser = await getUserById(mockUser.id);
      if (currentUser) {
        console.log('User finded: ', currentUser);
      } else {
        await createUser(mockUser);
        console.log('User created: ', mockUser);
      }
    } catch (error) {
      console.error('Error in database operation:', error);
    }
  });

  const app = express();
  app.use(cookieParser());
  app.use(cors());
  app.use(express.json());

  let vite: ViteDevServer | undefined;
  if (isDev) {
    vite = await createViteServer({
      server: { middlewareMode: true },
      root: clientPath,
      appType: 'custom',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(clientPath, 'dist/client'), { index: false }));
  }

  app.use('/api', router);

  app.get('/user', (_, res) => {
    res.json(mockUser);
  });

  app.get('*', async (req, res, next) => {
    const url = req.originalUrl;

    try {
      // Создаём переменные
      let render: (req: ExpressRequest) => Promise<{ html: string; initialState: unknown; styleTags: string }>;
      let template: string;

      if (vite) {
        template = await fs.readFile(path.resolve(clientPath, 'index.html'), 'utf-8');

        template = await vite.transformIndexHtml(url, template);
        render = (await vite.ssrLoadModule(path.join(clientPath, 'src/entry-server.tsx'))).render;
      } else {
        template = await fs.readFile(path.join(clientPath, 'dist/client/index.html'), 'utf-8');

        // Получаем путь до сбилдженого модуля клиента, чтобы не тащить средства сборки клиента на сервер
        const pathToServer = path.join(clientPath, 'dist/server/entry-server.cjs');

        render = (await import(pathToServer)).render;
      }

      const { html: appHtml, initialState, styleTags } = await render(req);
      const html = template
        .replace('<!--ssr-styles-->', `<style>${styleTags}</style>`)
        .replace('<!--ssr-outlet-->', appHtml)
        .replace(
          '<!--ssr-initial-state-->',
          `<script>window.APP_INITIAL_STATE = ${serialize(initialState, {
            isJSON: true,
          })}</script>`,
        );
      // Завершаем запрос и отдаём HTML-страницу
      res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
    } catch (e) {
      if (vite) {
        vite.ssrFixStacktrace(e as Error);
      }
      next(e);
    }
  });

  app.listen(port, () => {
    console.log(`  ➜ 🎸 Server is listening on port: ${port}`);
  });
}

createServer();
