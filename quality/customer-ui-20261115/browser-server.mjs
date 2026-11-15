import {createServer} from 'vite';
import tailwind from '@tailwindcss/postcss';
const repo=process.cwd();
const fixtureRoot=process.env.GRIDEX_UI_FIXTURE_DIR || '/tmp/gridex-ui-browser-20261115';
const server=await createServer({configFile:false,root:fixtureRoot,esbuild:{jsx:'automatic'},css:{postcss:{plugins:[tailwind()]}},server:{host:'127.0.0.1',port:4187,strictPort:true,fs:{allow:[fixtureRoot,repo]}}});
await server.listen(); console.log('UI fixture server ready on isolated port 4187');
