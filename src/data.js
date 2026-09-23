// Station data layer: curated verified stations + curated mainland-China
// stations + live radio-browser catalogue.
import pinnedRaw from './curated-stations.json';
import cnRaw from './cn-stations.json';

const API_HOSTS = [
  'de1.api.radio-browser.info',
  'nl1.api.radio-browser.info',
  'at1.api.radio-browser.info',
  'fi1.api.radio-browser.info',
  'de2.api.radio-browser.info',
];

export const REGIONS = [
  { id: 'ALL', label: '全部' },
  { id: 'AS', label: '亚洲' },
  { id: 'EU', label: '欧洲' },
  { id: 'NA', label: '北美洲' },
  { id: 'SA', label: '南美洲' },
  { id: 'AF', label: '非洲' },
  { id: 'OC', label: '大洋洲' },
];

const CC_REGION = {
  CN: 'AS', HK: 'AS', TW: 'AS', JP: 'AS', KR: 'AS', KP: 'AS', MN: 'AS',
  IN: 'AS', PK: 'AS', BD: 'AS', LK: 'AS', NP: 'AS', MV: 'AS', BT: 'AS',
  TH: 'AS', VN: 'AS', ID: 'AS', MY: 'AS', SG: 'AS', PH: 'AS', MM: 'AS',
  KH: 'AS', LA: 'AS', BN: 'AS', TL: 'AS',
  AE: 'AS', SA: 'AS', QA: 'AS', KW: 'AS', BH: 'AS', OM: 'AS', YE: 'AS',
  IQ: 'AS', IR: 'AS', AF: 'AS', SY: 'AS', JO: 'AS', LB: 'AS', IL: 'AS',
  PS: 'AS', TR: 'AS', CY: 'AS', GE: 'AS', AM: 'AS', AZ: 'AS', KZ: 'AS',
  UZ: 'AS', TM: 'AS', KG: 'AS', TJ: 'AS',
  RU: 'EU', UA: 'EU', BY: 'EU', MD: 'EU',
  GB: 'EU', IE: 'EU', FR: 'EU', DE: 'EU', NL: 'EU', BE: 'EU', LU: 'EU',
  CH: 'EU', AT: 'EU', IT: 'EU', VA: 'EU', MT: 'EU', ES: 'EU', PT: 'EU',
  AD: 'EU', MC: 'EU', SM: 'EU',
  SE: 'EU', NO: 'EU', DK: 'EU', FI: 'EU', IS: 'EU', EE: 'EU', LV: 'EU',
  LT: 'EU', PL: 'EU', CZ: 'EU', SK: 'EU', HU: 'EU', RO: 'EU', BG: 'EU',
  GR: 'EU', AL: 'EU', BA: 'EU', ME: 'EU', RS: 'EU', MK: 'EU', HR: 'EU', SI: 'EU',
  XK: 'EU', LI: 'EU', FO: 'EU', GI: 'EU', IM: 'EU', JE: 'EU', GG: 'EU',
  AX: 'EU',
  US: 'NA', CA: 'NA', MX: 'NA', GL: 'NA', BM: 'NA', PM: 'NA',
  BZ: 'NA', GT: 'NA', HN: 'NA', SV: 'NA', NI: 'NA', CR: 'NA', PA: 'NA',
  CU: 'NA', JM: 'NA', HT: 'NA', DO: 'NA', BS: 'NA', BB: 'NA', TT: 'NA',
  GD: 'NA', LC: 'NA', VC: 'NA', KN: 'NA', DM: 'NA', AG: 'NA', PR: 'NA',
  KY: 'NA', VG: 'NA', AI: 'NA', MS: 'NA', AW: 'NA', CW: 'NA', SX: 'NA',
  BQ: 'NA', MF: 'NA', GP: 'NA', MQ: 'NA', BL: 'NA', TC: 'NA',
  BR: 'SA', AR: 'SA', CL: 'SA', CO: 'SA', PE: 'SA', VE: 'SA', UY: 'SA',
  PY: 'SA', BO: 'SA', EC: 'SA', GY: 'SA', SR: 'SA', FK: 'SA',
  MA: 'AF', DZ: 'AF', TN: 'AF', LY: 'AF', EG: 'AF', SD: 'AF', SS: 'AF',
  ET: 'AF', ER: 'AF', DJ: 'AF', SO: 'AF', KE: 'AF', UG: 'AF', TZ: 'AF',
  RW: 'AF', BI: 'AF', MZ: 'AF', ZW: 'AF', ZA: 'AF', NA: 'AF', BW: 'AF',
  ZM: 'AF', AO: 'AF', CD: 'AF', CG: 'AF', CM: 'AF', NG: 'AF', GH: 'AF',
  CI: 'AF', SN: 'AF', ML: 'AF', BF: 'AF', NE: 'AF', TD: 'AF', CF: 'AF',
  CM: 'AF', TG: 'AF', BJ: 'AF', GN: 'AF', SL: 'AF', LR: 'AF', MR: 'AF',
  EH: 'AF', GA: 'AF', GQ: 'AF', ST: 'AF', KM: 'AF', MU: 'AF', SC: 'AF',
  MG: 'AF', LS: 'AF', SZ: 'AF', MW: 'AF',
  AU: 'OC', NZ: 'OC', PG: 'OC', FJ: 'OC', SB: 'OC', VU: 'OC', NC: 'OC',
  WS: 'OC', TO: 'OC', KI: 'OC', TV: 'OC', NR: 'OC', PW: 'OC', FM: 'OC',
  MH: 'OC', CK: 'OC', NU: 'OC', PF: 'OC', GU: 'OC',
};
// Fallback for unknown country codes: classify by longitude/latitude boxes.
function regionFromGeo(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number') return 'EU';
  // Oceania
  if ((lon >= 109 && lon <= 180 && lat <= 0) || (lon >= 155 && lon <= 180 && lat <= -25)) return 'OC';
  if (lon >= 109 && lon <= 160 && lat >= -48 && lat <= -10) return 'OC';
  // Americas
  if (lon <= -34) {
    if (lat >= 13) return 'NA';
    return 'SA';
  }
  // Africa
  if (lon >= -20 && lon <= 55 && lat >= -36 && lat <= 37) return 'AF';
  // Europe (incl. western Russia edge handled by explicit codes)
  if (lon >= -25 && lon <= 45 && lat >= 36 && lat <= 72) return 'EU';
  // Asia / everything else in the eastern hemisphere
  if (lon >= 40) return 'AS';
  return 'EU';
}

export function regionOf(cc, lat, lon) {
  return CC_REGION[cc] || regionFromGeo(lat, lon);
}

// Stream origins without a browser-friendly CORS policy; the Vite dev server
// relays them (see vite.config.js) so hls.js / <audio> can load the stream.
// Manifests are rewritten so every follow-up segment stays inside the relay;
// plain audio (MP3/AAC) is passed through byte-for-byte with Range support.
const STREAM_PROXY_HOSTS = new Set([
  'ngcdn001.cnr.cn', // CNR 中国之声 / 音乐之声
  'ngcdn002.cnr.cn', // CNR 经济之声
  'ngcdn003.cnr.cn',
  'ngcdn004.cnr.cn',
  'ngcdn005.cnr.cn',
  'ngcdn006.cnr.cn',
  'ngcdn007.cnr.cn',
  'ngcdn008.cnr.cn',
  'ls.qingting.fm', // 蜻蜓网络 HLS
  'live.xmcdn.com', // 喜马拉雅
  'live.ximalaya.com',
]);

// hls.js fetches manifests/segments via XHR, which requires a CORS header.
// Most broadcasters do NOT send one, so an .m3u8 stream that works in VLC
// will silently fail in the browser. We relay EVERY hls stream through the
// dev-server proxy, which injects `access-control-allow-origin: *` and
// rewrites playlist URIs so follow-up segments stay inside the relay.
// Plain MP3/AAC is left untouched — <audio> can play those cross-origin
// without CORS.
// On static hosting (GitHub Pages) there is no dev-server middleware, so the
// HLS relay runs on a Cloudflare Worker. Set the base once at build/run time;
// when empty (local dev) the same-origin `/__streampxy/` path is used.
const WORKER_PROXY_RAW = (typeof globalThis !== 'undefined' && globalThis.__ORBIS_WORKER__) || '';
const WORKER_PROXY = WORKER_PROXY_RAW && WORKER_PROXY_RAW.indexOf('__ORBIS_WORKER') === -1 ? WORKER_PROXY_RAW : '';
const PROXY_BASE = (() => {
  if (WORKER_PROXY) return WORKER_PROXY.replace(/\/$/, '');
  // localhost / dev: keep same-origin path handled by vite.config.js
  return '';
})();

export function proxifyHls(url, kind) {
  if (!url) return url;
  const isHls = kind === 'hls' || /\.m3u8(\?|$)/i.test(url);
  if (!isHls) return url;
  try {
    const u = new URL(url);
    // avoid double-wrapping an already-proxied URL
    if (u.pathname.startsWith('/__streampxy/')) return url;
    const rel = `/__streampxy/${u.protocol === 'http:' ? 'http' : 'https'}/${u.host}${u.pathname}${u.search}`;
    return PROXY_BASE ? `${PROXY_BASE}${rel}` : rel;
  } catch {
    return url;
  }
}

export const COUNTRY_ZH = {
  CN: '中国', HK: '中国香港', TW: '中国台湾', MO: '中国澳门', JP: '日本', KR: '韩国',
  KP: '朝鲜', MN: '蒙古', IN: '印度', PK: '巴基斯坦', BD: '孟加拉国', LK: '斯里兰卡',
  NP: '尼泊尔', MV: '马尔代夫', TH: '泰国', VN: '越南', ID: '印度尼西亚',
  MY: '马来西亚', SG: '新加坡', PH: '菲律宾', MM: '缅甸', KH: '柬埔寨', LA: '老挝',
  BN: '文莱', TL: '东帝汶', AE: '阿联酋', SA: '沙特阿拉伯', QA: '卡塔尔',
  KW: '科威特', BH: '巴林', OM: '阿曼', YE: '也门', IQ: '伊拉克', IR: '伊朗',
  AF: '阿富汗', SY: '叙利亚', JO: '约旦', LB: '黎巴嫩', IL: '以色列', PS: '巴勒斯坦',
  TR: '土耳其', CY: '塞浦路斯', GE: '格鲁吉亚', AM: '亚美尼亚', AZ: '阿塞拜疆',
  KZ: '哈萨克斯坦', UZ: '乌兹别克斯坦', TM: '土库曼斯坦', KG: '吉尔吉斯斯坦',
  TJ: '塔吉克斯坦',
  RU: '俄罗斯', UA: '乌克兰', BY: '白俄罗斯', MD: '摩尔多瓦',
  GB: '英国', IE: '爱尔兰', FR: '法国', DE: '德国', NL: '荷兰', BE: '比利时',
  LU: '卢森堡', CH: '瑞士', AT: '奥地利', IT: '意大利', ES: '西班牙', PT: '葡萄牙',
  AD: '安道尔', MC: '摩纳哥', SE: '瑞典', NO: '挪威', DK: '丹麦', FI: '芬兰',
  IS: '冰岛', EE: '爱沙尼亚', LV: '拉脱维亚', LT: '立陶宛', PL: '波兰',
  CZ: '捷克', SK: '斯洛伐克', HU: '匈牙利', RO: '罗马尼亚', BG: '保加利亚',
  GR: '希腊', AL: '阿尔巴尼亚', RS: '塞尔维亚', HR: '克罗地亚', SI: '斯洛文尼亚',
  BA: '波黑', ME: '黑山', MK: '北马其顿',
  US: '美国', CA: '加拿大', MX: '墨西哥', GL: '格陵兰',
  BR: '巴西', AR: '阿根廷', CL: '智利', CO: '哥伦比亚', PE: '秘鲁', VE: '委内瑞拉',
  UY: '乌拉圭', PY: '巴拉圭', BO: '玻利维亚', EC: '厄瓜多尔', GY: '圭亚那', SR: '苏里南',
  MA: '摩洛哥', DZ: '阿尔及利亚', TN: '突尼斯', LY: '利比亚', EG: '埃及',
  SD: '苏丹', ET: '埃塞俄比亚', ER: '厄立特里亚', SO: '索马里', KE: '肯尼亚',
  UG: '乌干达', TZ: '坦桑尼亚', RW: '卢旺达', BI: '布隆迪', MZ: '莫桑比克',
  ZW: '津巴布韦', ZA: '南非', NA: '纳米比亚', BW: '博茨瓦纳', ZM: '赞比亚',
  AO: '安哥拉', CD: '刚果（金）', CG: '刚果（布）', CM: '喀麦隆', NG: '尼日利亚',
  GH: '加纳', CI: '科特迪瓦', SN: '塞内加尔', ML: '马里', NE: '尼日尔',
  TD: '乍得', CF: '中非', TG: '多哥', BJ: '贝宁', GN: '几内亚', SL: '塞拉利昂',
  LR: '利比里亚', MR: '毛里塔尼亚', GA: '加蓬', GQ: '赤道几内亚',
  MG: '马达加斯加', MU: '毛里求斯', SC: '塞舌尔', KM: '科摩罗', LS: '莱索托',
  SZ: '斯威士兰', MW: '马拉维',
  AU: '澳大利亚', NZ: '新西兰', PG: '巴布亚新几内亚', FJ: '斐济', SB: '所罗门群岛',
  VU: '瓦努阿图', NC: '新喀里多尼亚', WS: '萨摩亚', TO: '汤加', KI: '基里巴斯',
  FM: '密克罗尼西亚', MH: '马绍尔群岛', PF: '法属波利尼西亚', GU: '关岛',
};

const CITY_ZH = {
  Beijing: '北京', Shanghai: '上海', Guangzhou: '广州', Shenzhen: '深圳',
  'Hong Kong': '香港', Taipei: '台北', Kaohsiung: '高雄', Tokyo: '东京', Osaka: '大阪',
  Kyoto: '京都', Seoul: '首尔', Busan: '釜山', Pyongyang: '平壤',
  Bangkok: '曼谷', Hanoi: '河内', 'Ho Chi Minh City': '胡志明市', Jakarta: '雅加达',
  Manila: '马尼拉', 'Kuala Lumpur': '吉隆坡', Singapore: '新加坡', Yangon: '仰光',
  'Phnom Penh': '金边', Vientiane: '万象', 'Bandar Seri Begawan': '斯里巴加湾市',
  'New Delhi': '新德里', Delhi: '德里', Mumbai: '孟买', Bengaluru: '班加罗尔',
  Kolkata: '加尔各答', Chennai: '钦奈', Karachi: '卡拉奇', Lahore: '拉合尔',
  Islamabad: '伊斯兰堡', Dhaka: '达卡', Colombo: '科伦坡', Kathmandu: '加德满都',
  Dubai: '迪拜', 'Abu Dhabi': '阿布扎比', Doha: '多哈', Riyadh: '利雅得',
  Jeddah: '吉达', 'Kuwait City': '科威特城', Muscat: '马斯喀特', Baghdad: '巴格达',
  Tehran: '德黑兰', Damascus: '大马士革', Amman: '安曼', Beirut: '贝鲁特',
  Jerusalem: '耶路撒冷', 'Tel Aviv': '特拉维夫', Istanbul: '伊斯坦布尔', Ankara: '安卡拉',
  Tbilisi: '第比利斯', Yerevan: '埃里温', Baku: '巴库', Almaty: '阿拉木图',
  Tashkent: '塔什干', Astana: '阿斯塔纳',
  Moscow: '莫斯科', 'Saint Petersburg': '圣彼得堡', Novosibirsk: '新西伯利亚',
  Kyiv: '基辅', Minsk: '明斯克',
  London: '伦敦', Manchester: '曼彻斯特', Edinburgh: '爱丁堡', Liverpool: '利物浦',
  Dublin: '都柏林', Paris: '巴黎', Marseille: '马赛', Lyon: '里昂', Nice: '尼斯',
  Berlin: '柏林', Munich: '慕尼黑', Hamburg: '汉堡', Frankfurt: '法兰克福',
  Cologne: '科隆', Amsterdam: '阿姆斯特丹', Rotterdam: '鹿特丹', Brussels: '布鲁塞尔',
  Antwerp: '安特卫普', Luxembourg: '卢森堡', Zurich: '苏黎世', Geneva: '日内瓦',
  Bern: '伯尔尼', Lucerne: '卢塞恩', Vienna: '维也纳', Salzburg: '萨尔茨堡',
  Rome: '罗马', Milan: '米兰', Naples: '那不勒斯', Turin: '都灵', Florence: '佛罗伦萨',
  Venice: '威尼斯', Madrid: '马德里', Barcelona: '巴塞罗那', Valencia: '巴伦西亚',
  Seville: '塞维利亚', Lisbon: '里斯本', Porto: '波尔图', Stockholm: '斯德哥尔摩',
  Gothenburg: '哥德堡', Oslo: '奥斯陆', Copenhagen: '哥本哈根', Helsinki: '赫尔辛基',
  Reykjavik: '雷克雅未克', Tallinn: '塔林', Riga: '里加', Vilnius: '维尔纽斯',
  Warsaw: '华沙', Kraków: '克拉科夫', Prague: '布拉格', Bratislava: '布拉迪斯拉发',
  Budapest: '布达佩斯', Bucharest: '布加勒斯特', Sofia: '索非亚', Athens: '雅典',
  Thessaloniki: '塞萨洛尼基', Belgrade: '贝尔格莱德', Zagreb: '萨格勒布',
  Ljubljana: '卢布尔雅那', Sarajevo: '萨拉热窝',
  'New York': '纽约', 'Los Angeles': '洛杉矶', Chicago: '芝加哥', Houston: '休斯敦',
  Phoenix: '菲尼克斯', Philadelphia: '费城', 'San Antonio': '圣安东尼奥',
  'San Diego': '圣迭戈', Dallas: '达拉斯', 'San Francisco': '旧金山',
  Seattle: '西雅图', Boston: '波士顿', Atlanta: '亚特兰大', Miami: '迈阿密',
  Denver: '丹佛', Detroit: '底特律', 'Las Vegas': '拉斯维加斯',
  'Mexico City': '墨西哥城', Guadalajara: '瓜达拉哈拉', Monterrey: '蒙特雷',
  Toronto: '多伦多', Montreal: '蒙特利尔', Vancouver: '温哥华', Ottawa: '渥太华',
  Calgary: '卡尔加里', Havana: '哈瓦那',
  'São Paulo': '圣保罗', 'Rio de Janeiro': '里约热内卢', Brasília: '巴西利亚',
  Salvador: '萨尔瓦多', 'Buenos Aires': '布宜诺斯艾利斯', Córdoba: '科尔多瓦',
  Rosario: '罗萨里奥', Santiago: '圣地亚哥', Valparaíso: '瓦尔帕莱索',
  Bogotá: '波哥大', Medellín: '麦德林', Cali: '卡利', Lima: '利马',
  Caracas: '加拉加斯', Montevideo: '蒙得维的亚', Asunción: '亚松森',
  'La Paz': '拉巴斯', Quito: '基多', Guayaquil: '瓜亚基尔',
  Cairo: '开罗', Alexandria: '亚历山大', Casablanca: '卡萨布兰卡', Rabat: '拉巴特',
  Algiers: '阿尔及尔', Tunis: '突尼斯市', Tripoli: '的黎波里', Khartoum: '喀土穆',
  Nairobi: '内罗毕', Lagos: '拉各斯', Abuja: '阿布贾', Accra: '阿克拉',
  'Addis Ababa': '亚的斯亚贝巴', 'Dar es Salaam': '达累斯萨拉姆', Kampala: '坎帕拉',
  Dakar: '达喀尔', Abidjan: '阿比让', Luanda: '罗安达', Kinshasa: '金沙萨',
  Johannesburg: '约翰内斯堡', 'Cape Town': '开普敦', Durban: '德班', Pretoria: '比勒陀利亚',
  Maputo: '马普托', Harare: '哈拉雷', Lusaka: '卢萨卡', Antananarivo: '塔那那利佛',
  Sydney: '悉尼', Melbourne: '墨尔本', Brisbane: '布里斯班', Perth: '珀斯',
  Adelaide: '阿德莱德', Canberra: '堪培拉', Auckland: '奥克兰', Wellington: '惠灵顿',
  Christchurch: '克赖斯特彻奇', Suva: '苏瓦',
};

// genre chip definitions: keyword appears in tags/genre (en) or zh label
export const GENRES = [
  { id: 'news', label: '新闻谈话', keys: ['news', 'talk', 'speech', '新闻', '谈话'] },
  { id: 'pop', label: '流行', keys: ['pop', 'top40', 'top 40', 'hits', 'charts', '流行'] },
  { id: 'rock', label: '摇滚独立', keys: ['rock', 'indie', 'alternative', 'punk', 'grunge', 'metal', '摇滚', '独立', '金属', '另类'] },
  { id: 'jazz', label: '爵士灵魂', keys: ['jazz', 'swing', 'blues', 'soul', 'funk', 'rnb', 'r&b', '爵士'] },
  { id: 'classical', label: '古典', keys: ['classical', 'orchestral', 'opera', 'baroque', '古典'] },
  { id: 'electronic', label: '电子舞曲', keys: ['electronic', 'electro', 'techno', 'house', 'trance', 'edm', 'dance', 'dubstep', 'drum and bass', '电子', '舞曲'] },
  { id: 'hiphop', label: '嘻哈说唱', keys: ['hip hop', 'hiphop', 'rap', '嘻哈'] },
  { id: 'folk', label: '民谣乡村', keys: ['folk', 'country', 'americana', '民谣', '乡村'] },
  { id: 'latin', label: '拉丁', keys: ['latin', 'latino', 'reggaeton', 'salsa', 'bossa', 'samba', 'mpb', '拉丁'] },
  { id: 'chill', label: '氛围弛放', keys: ['ambient', 'chillout', 'chill', 'lounge', 'easy listening', '氛围', '弛放'] },
  { id: 'oldies', label: '经典金曲', keys: ['oldies', 'classic hits', 'retro', '70s', '80s', '90s', 'gold', '经典'] },
  { id: 'religion', label: '宗教', keys: ['christian', 'gospel', 'catholic', 'islamic', 'religious', 'religion', '宗教'] },
];

export function zhCity(name) {
  if (!name) return '';
  return CITY_ZH[name] || name;
}

function guessGenre(tags, pinnedGenre) {
  const hay = `${tags || ''} ${pinnedGenre || ''}`.toLowerCase();
  for (const g of GENRES) {
    if (g.keys.some(k => hay.includes(k))) return g.id;
  }
  return '';
}

function httpGetJson(url, timeoutMs = 18000, hostIdx = 0) {
  return new Promise((resolve, reject) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } })
      .then(async (r) => {
        clearTimeout(t);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        resolve(await r.json());
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

async function apiCall(path) {
  let lastErr;
  for (const host of API_HOSTS) {
    try {
      return await httpGetJson(`https://${host}${path}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Constrained cross-border links often cannot pull a full page within the
// timeout; retry the same query once with a halved limit before giving up.
async function apiCallLadder(path) {
  try {
    return await apiCall(path);
  } catch (e) {
    const m = path.match(/limit=(\d+)/);
    if (!m) throw e;
    const half = Math.max(300, Math.floor(Number(m[1]) / 2));
    return apiCall(path.replace(/limit=\d+/, 'limit=' + half));
  }
}

function normalizeApiRow(r) {
  const rawUrl = r.url_resolved || r.url;
  if (!rawUrl || !/^https?:\/\//.test(rawUrl)) return null;
  if (/\.(pls|asx|xspf|ram)(\?|$)/i.test(rawUrl)) return null;
  const lat = Number(r.geo_lat);
  const lon = Number(r.geo_long);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // radio-browser returns (0,0) for stations without coordinates even with
  // has_geo=true — treat null island as missing data, not a real position
  if (lat === 0 && lon === 0) return null;
  if (lat < -85 || lat > 85 || lon < -180 || lon > 180) return null;
  let name = (r.name || '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 48 || name.length < 2) return null;
  if (/test|backup|offline|404|coming soon/i.test(name)) return null;
  const cc = (r.countrycode || '').toUpperCase();
  if (!cc) return null;
  const tags = (r.tags || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 5).join(',');
  const url = rawUrl;
  return {
    name,
    city: (r.state || '').split(/[,/]/)[0].trim(),
    countryEn: (r.country || '').trim(),
    country: COUNTRY_ZH[cc] || (r.country || '').trim(),
    cc,
    lat,
    lon,
    url,
    kind: /\.m3u8(\?|$)/i.test(url) ? 'hls' : 'live',
    tags,
    codec: (r.codec || '').toUpperCase(),
    bitrate: r.bitrate || 0,
    favicon: r.favicon && /^https?:\/\//.test(r.favicon) ? r.favicon : '',
    votes: r.votes || 0,
    clicks: r.clickcount || 0,
    genreId: guessGenre(tags),
    source: 'api',
  };
}

/**
 * Load full station catalogue.
 * @returns {Promise<{stations: Array, offline: boolean}>}
 */
export async function loadStations() {
  const pinned = pinnedRaw.map((s) => ({
    name: s.name,
    city: s.city,
    country: s.country,
    countryEn: '',
    cc: s.cc,
    lat: s.lat,
    lon: s.lon,
    url: s.url,
    kind: s.kind || 'live',
    tags: s.tags || '',
    codec: '',
    bitrate: 0,
    favicon: '',
    votes: 9999,
    clicks: 9999,
    genreId: guessGenre(s.tags, s.genre),
    source: 'curated',
  }));

  // Hand-curated, individually verified mainland-China / overseas-Chinese
  // stations (national / provincial / city / internet levels).
  const cnPinned = cnRaw.map((s) => ({
    name: s.name,
    city: s.city,
    cityZh: s.city,
    country: COUNTRY_ZH[s.cc] || '中国',
    countryEn: '',
    cc: s.cc,
    lat: s.lat,
    lon: s.lon,
    url: s.url,
    kind: s.kind || 'live',
    tags: s.tags || '',
    codec: '',
    bitrate: s.bitrate || 0,
    favicon: '',
    votes: 9800,
    clicks: 9800,
    genreId: guessGenre(s.tags, s.genre),
    source: 'cn',
    level: s.level || 'network',
  }));
  pinned.push(...cnPinned);

  let rows = [];
  let offline = false;
  try {
    // Popularity orders skew toward big broadcasters that lack coordinates;
    // clicktrend/random/clicks orders carry far more geo-tagged stations. A
    // dedicated China query keeps the domestic catalogue dense, and a second
    // votes page guarantees depth beyond the top-1200. Every route is
    // best-effort: one flaky mirror must not sink the whole catalogue.
    const BASE = 'has_geo_info=true&lastcheckok=1&hidebroken=true';
    const routes = [
      `/json/stations/search?${BASE}&limit=1200&offset=0&order=votes&reverse=true`,
      `/json/stations/search?${BASE}&limit=1200&offset=1200&order=votes&reverse=true`,
      `/json/stations/search?${BASE}&limit=1200&order=clicks&reverse=true`,
      `/json/stations/search?${BASE}&limit=1200&order=clicktrend&reverse=true`,
      `/json/stations/search?${BASE}&limit=1000&order=random`,
      `/json/stations/search?${BASE}&limit=1200&countrycode=CN&order=votes&reverse=true`,
    ];
    const settled = await Promise.allSettled(routes.map((p) => apiCallLadder(p)));
    for (const r of settled) {
      if (r.status === 'fulfilled' && Array.isArray(r.value)) rows = rows.concat(r.value);
    }
    if (!rows.length) throw new Error('all routes failed');
  } catch (e) {
    offline = true;
  }

  const seenUrl = new Set(pinned.map((s) => s.url.split('?')[0]));
  const seenName = new Set(pinned.map((s) => s.name.toLowerCase() + '@' + s.cc));
  const live = [];
  for (const r of rows) {
    const s = normalizeApiRow(r);
    if (!s) continue;
    const u = s.url.split('?')[0];
    const nk = s.name.toLowerCase() + '@' + s.cc;
    if (seenUrl.has(u) || seenName.has(nk)) continue;
    seenUrl.add(u);
    seenName.add(nk);
    live.push(s);
  }

  live.sort((a, b) => (b.votes + b.clicks * 0.05) - (a.votes + a.clicks * 0.05));
  const stations = pinned.concat(live).map((s, i) => {
    s.id = i;
    s.region = regionOf(s.cc, s.lat, s.lon);
    s.cityZh = s.cityZh || zhCity(s.city);
    s.url = proxifyHls(s.url, s.kind);
    return s;
  });
  spreadOverlappingPoints(stations);
  if (!offline && stations.length > 100) saveCachedStations(stations);
  return { stations, offline };
}

// City-scale stations often share exact coordinates (or (0,0)-cleaned pins),
// which renders as one dot covering the rest. Fan duplicates out on a small
// golden-angle spiral (~10–25 km) so every dot is individually clickable.
function spreadOverlappingPoints(stations) {
  const GOLDEN = 2.3999632297;
  const groups = new Map();
  for (const s of stations) {
    const key = `${s.lat.toFixed(3)},${s.lon.toFixed(3)}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else groups.set(key, [s]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.forEach((s, k) => {
      if (k === 0) return;
      const angle = k * GOLDEN;
      const radius = 0.09 + 0.055 * Math.floor(Math.sqrt(k));
      s.lat += Math.cos(angle) * radius;
      s.lon += Math.sin(angle) * radius * 0.82;
    });
  }
}

/* ---------------- session cache (instant reload + offline fallback) ---------------- */

const CACHE_KEY = 'orbis.catalogue.v2';
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function saveCachedStations(stations) {
  try {
    // drop runtime-only fields; ids are reassigned on every load
    const slim = stations.map(({ id, ...rest }) => rest);
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), stations: slim }));
  } catch {}
}

export function getCachedStations() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, stations } = JSON.parse(raw);
    if (!Array.isArray(stations) || !stations.length) return null;
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return stations.map((s, i) => ({ ...s, id: i }));
  } catch {
    return null;
  }
}
