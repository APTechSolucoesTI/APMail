import { mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const dir = new URL('../public/images/screenshots/', import.meta.url);
const pathFor = (name) => fileURLToPath(new URL(name, dir));
await mkdir(dir, { recursive: true });

const esc = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function overlay(width, height, shapes) {
  const body = shapes.map(({ x = 0, y = 0, w, h, fill = '#ffffff', text, color = '#344054', size = 13, weight = 600 }) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}"/><text x="${x + 8}" y="${y + h / 2 + size / 3}" fill="${color}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${weight}">${esc(text ?? '')}</text>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
}
async function make(name, crop, shapes) {
  const input = pathFor(`${name}-raw.jpg`);
  const output = pathFor(`${name}.jpg`);
  const source = sharp(input);
  const metadata = await source.metadata();
  const width = crop?.width ?? metadata.width;
  const height = crop?.height ?? metadata.height;
  let image = source;
  if (crop) image = image.extract(crop);
  await image.composite([{ input: overlay(width, height, shapes), top: 0, left: 0 }]).jpeg({ quality: 92, chromaSubsampling: '4:4:4' }).toFile(output);
  await unlink(input);
}

// The raw captures are 800x600 browser images. Crops keep the useful UI and
// remove tables, audit trails and message subjects that are not needed in the guide.
await make('dashboard', { left: 205, top: 38, width: 595, height: 355 }, [
  { x: 0, y: 0, w: 595, h: 38, fill: '#ffffff', text: 'Dashboard · Empresa Exemplo', color: '#0d2b5e', size: 15 },
  { x: 0, y: 38, w: 595, h: 42, fill: '#ffffff', text: 'Volume, produtividade e prioridades nas caixas permitidas.', color: '#667085', size: 11, weight: 400 },
  { x: 0, y: 83, w: 595, h: 54, fill: '#ffffff', text: 'Período       Últimos 30 dias       Caixa       Todas as caixas', color: '#344054', size: 11 },
  { x: 0, y: 140, w: 595, h: 215, fill: '#ffffff', text: 'Indicadores · Recebidos   Enviados   A responder   Em atendimento', color: '#0d2b5e', size: 14 },
  { x: 0, y: 169, w: 595, h: 185, fill: '#ffffff', text: 'Os valores exibidos neste exemplo são fictícios.', color: '#667085', size: 12, weight: 400 },
]);
await make('calendar', { left: 205, top: 38, width: 595, height: 500 }, [
  { x: 0, y: 0, w: 595, h: 43, fill: '#ffffff', text: 'Calendário', color: '#0d2b5e', size: 16 },
  { x: 0, y: 43, w: 595, h: 29, fill: '#ffffff', text: 'Compromissos, reuniões e lembretes · America/Sao_Paulo', color: '#667085', size: 11, weight: 400 },
  { x: 0, y: 72, w: 190, h: 428, fill: '#ffffff', text: 'Meus calendários', color: '#0d2b5e', size: 13 },
  { x: 189, y: 72, w: 406, h: 428, fill: '#ffffff', text: 'Semana · nenhum compromisso demonstrativo', color: '#667085', size: 12, weight: 400 },
]);
await make('preferences', { left: 205, top: 38, width: 595, height: 500 }, [
  { x: 0, y: 0, w: 595, h: 42, fill: '#ffffff', text: 'Preferências', color: '#0d2b5e', size: 16 },
  { x: 0, y: 42, w: 595, h: 30, fill: '#ffffff', text: 'Personalize sua experiência, suas notificações e a segurança da conta.', color: '#667085', size: 11, weight: 400 },
  { x: 0, y: 73, w: 595, h: 45, fill: '#ffffff', text: 'Geral     E-mail     Notificações     Convites     Composição     2FA', color: '#137a98', size: 11 },
  { x: 0, y: 118, w: 595, h: 382, fill: '#ffffff', text: 'Geral · Tema · Fuso horário · Salvar', color: '#0d2b5e', size: 14 },
]);
await make('composer', { left: 365, top: 65, width: 435, height: 535 }, [
  { x: 0, y: 0, w: 435, h: 36, fill: '#ffffff', text: 'Novo e-mail · rascunho automático', color: '#0d2b5e', size: 14 },
  { x: 0, y: 38, w: 435, h: 35, fill: '#ffffff', text: 'De: Comercial <comercial@exemplo.com.br>', color: '#344054', size: 11 },
  { x: 0, y: 73, w: 435, h: 38, fill: '#ffffff', text: 'Para: cliente@exemplo.com.br', color: '#344054', size: 11 },
  { x: 0, y: 111, w: 435, h: 34, fill: '#ffffff', text: 'Assunto: Solicitação de orçamento', color: '#344054', size: 11 },
  { x: 0, y: 145, w: 435, h: 320, fill: '#ffffff', text: 'Escreva uma mensagem de exemplo…', color: '#98a2b3', size: 12, weight: 400 },
]);
await make('admin', { left: 205, top: 38, width: 595, height: 500 }, [
  { x: 0, y: 0, w: 595, h: 42, fill: '#ffffff', text: 'Painel Administrativo', color: '#0d2b5e', size: 16 },
  { x: 0, y: 42, w: 595, h: 32, fill: '#ffffff', text: 'Visão geral de Empresa Exemplo · conexões, configurações e segurança.', color: '#667085', size: 11, weight: 400 },
  { x: 0, y: 74, w: 595, h: 80, fill: '#ffffff', text: 'Acompanhe a operação da sua empresa', color: '#0d2b5e', size: 14 },
  { x: 0, y: 150, w: 595, h: 350, fill: '#ffffff', text: 'Domínios     Caixas de e-mail     Equipe e acesso     Segurança dos arquivos', color: '#344054', size: 12 },
  { x: 0, y: 190, w: 595, h: 300, fill: '#ffffff', text: 'Dados de demonstração anonimizados', color: '#667085', size: 12, weight: 400 },
]);
console.log('Sanitized dashboard, calendar, preferences, composer and admin captures.');
