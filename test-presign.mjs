import http from 'http';
const req = http.request('http://127.0.0.1:3005/api/documents/blob/upload/presign', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => { console.log("Status:", res.statusCode, "Body:", data); });
});
req.write(JSON.stringify({ uploads: [{ contentType: 'text/plain', size: 10 }] }));
req.end();
