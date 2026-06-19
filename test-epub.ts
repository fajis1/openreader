import * as fs from 'fs';
import JSZip from 'jszip';

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function extractTextFromEpub(buffer: Buffer): Promise<{ title: string; text: string }[]> {
  const zip = await JSZip.loadAsync(buffer);
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('Missing container.xml');
  
  const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfPathMatch) throw new Error('Missing OPF path');
  const opfPath = opfPathMatch[1];
  
  const opfContent = await zip.file(opfPath)?.async('string');
  if (!opfContent) throw new Error('Missing OPF file');
  
  const basePath = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
  
  const manifest: Record<string, string> = {};
  for (const match of opfContent.matchAll(/<item\s+([^>]+)>/gi)) {
    const attrs = match[1];
    const idMatch = attrs.match(/id="([^"]+)"/i);
    const hrefMatch = attrs.match(/href="([^"]+)"/i);
    if (idMatch && hrefMatch) {
      manifest[idMatch[1]] = hrefMatch[1];
    }
  }
  console.log("Manifest items:", Object.keys(manifest).length);
  
  const spine: string[] = [];
  for (const match of opfContent.matchAll(/<itemref\s+([^>]+)>/gi)) {
    const idrefMatch = match[1].match(/idref="([^"]+)"/i);
    if (idrefMatch) {
      spine.push(idrefMatch[1]);
    }
  }
  console.log("Spine items:", spine.length);
  
  const chapters: { title: string; text: string }[] = [];
  for (let i = 0; i < spine.length; i++) {
    const idref = spine[i];
    const href = manifest[idref];
    if (!href) {
      console.log(`No href for idref ${idref}`);
      continue;
    }
    const file = zip.file(basePath + href);
    if (!file) {
      console.log(`File not found in zip: ${basePath + href}`);
      continue;
    }
    
    const htmlContent = await file.async('string');
    const text = stripHtmlTags(htmlContent);
    console.log(`idref ${idref} -> html length: ${htmlContent.length}, text length: ${text.length}`);
    if (text.trim().length > 0) {
      chapters.push({
        title: `Chapter ${chapters.length + 1}`,
        text: text,
      });
    }
  }
  return chapters;
}

async function main() {
  const buffer = fs.readFileSync('/home/cisco/openreader/tests/files/sample.epub');
  const chapters = await extractTextFromEpub(buffer);
  console.log(`Found ${chapters.length} chapters.`);
}
main().catch(console.error);
