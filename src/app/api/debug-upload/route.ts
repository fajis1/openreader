import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: Request) {
  try {
    const buffer = Buffer.from(await req.arrayBuffer());
    if (buffer.length === 0) return NextResponse.json({ error: 'No file content' }, { status: 400 });

    const dest = path.join(process.cwd(), 'tests', 'files', 'adoption.pdf');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buffer);

    return NextResponse.json({ success: true, path: dest, sizeBytes: buffer.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  const html = `
  <!DOCTYPE html>
  <html>
  <head><title>Debug Upload</title></head>
  <body style="padding: 50px; font-family: sans-serif;">
    <h2>Upload PDF for AI Diagnostics</h2>
    <form id="uploadForm">
      <input type="file" name="file" accept=".pdf" />
      <button type="submit">Upload to Sandbox</button>
    </form>
    <div id="status" style="margin-top: 20px;"></div>
    <script>
      document.getElementById('uploadForm').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const file = form.file.files[0];
        if (!file) return alert('Select a file');
        
        document.getElementById('status').innerText = 'Uploading... Please wait (this can take 30 seconds for an 18 MB file)';
        
        const res = await fetch('/api/debug-upload', {
          method: 'POST',
          body: file,
          headers: {
             'Content-Type': 'application/pdf'
          }
        });
        const json = await res.json();
        document.getElementById('status').innerText = JSON.stringify(json);
      };
    </script>
  </body>
  </html>
  `;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html' } });
}
