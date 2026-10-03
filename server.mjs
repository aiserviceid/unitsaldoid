import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if (!target.startsWith(root+path.sep)) {res.writeHead(403);return res.end('Forbidden');}
    res.setHeader('Content-Type',mime[path.extname(target)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-cache');
    res.end(fs.readFileSync(target));
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT)||5173,()=>console.log('UnitSaldo: http://localhost:'+(Number(process.env.PORT)||5173)));
