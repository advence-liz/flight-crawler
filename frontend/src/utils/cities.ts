/**
 * 出发地预设值
 *
 * 为什么需要：出发地下拉框原本必须等 GET /api/flights/cities 返回才能选，
 * 而这个接口要读 airports 表 + 对 flights 做 MIN/MAX 日期聚合，Render 免费机
 * 冷启动时这段空窗能有几十秒——在此之前用户既选不了出发地也触发不了查询。
 *
 * 主干链路的机场（尤其北上广深蓉渝等枢纽）一年也没几次变化，直接内置一份，
 * 页面首屏即可选、可查；接口返回后再做并集合并，把新增机场补进来。
 *
 * 数据来源：backend/data/flight-crawler.db 的 airports 表（enableCrawl=1，共 73 个城市）。
 * 前 15 个按 flights 表出发航班量排序（主干枢纽），其余按拼音序。
 *
 * 维护方式：机场增减不需要手改这里——接口返回的新机场会自动并入列表；
 * 只有想让某个机场默认排到前面（热门位）时才需要改。
 */

/** 出发航班量最高的主干枢纽，排在下拉框最前面方便直接选 */
export const PRESET_MAJOR_CITIES = [
  '重庆',
  '北京',
  '海口',
  '西安',
  '深圳',
  '乌鲁木齐',
  '郑州',
  '广州',
  '杭州',
  '三亚',
  '天津',
  '长沙',
  '南宁',
  '贵阳',
  '成都',
];

/** 其余已发现的通航城市（拼音序） */
export const PRESET_OTHER_CITIES = [
  '阿勒泰',
  '阿尔山',
  '安庆',
  '北海',
  '昌都',
  '长春',
  '大连',
  '大理',
  '二连浩特',
  '福州',
  '桂林',
  '哈尔滨',
  '哈密',
  '合肥',
  '和田',
  '菏泽',
  '呼和浩特',
  '呼伦贝尔',
  '惠州',
  '霍林郭勒',
  '济南',
  '鸡西',
  '揭阳',
  '九江',
  '昆明',
  '兰州',
  '丽江',
  '丽水',
  '连云港',
  '林芝米林',
  '临沂',
  '南昌',
  '南京',
  '攀枝花',
  '青岛',
  '泉州',
  '厦门',
  '上海',
  '上饶',
  '沈阳',
  '石家庄',
  '太原',
  '通辽',
  '温州',
  '乌海',
  '乌兰浩特',
  '武汉',
  '西宁',
  '西双版纳',
  '信阳',
  '徐州',
  '宜昌',
  '银川',
  '榆林',
  '于田',
  '玉树',
  '舟山',
  '珠海',
];

/** 完整预设列表：主干枢纽在前，其余在后 */
export const PRESET_CITIES: string[] = [
  ...PRESET_MAJOR_CITIES,
  ...PRESET_OTHER_CITIES,
];

/**
 * 合并「预设列表」与「接口返回列表」：
 * 保持 preset 的原有顺序（避免下拉框在接口返回后整体重排、用户选到一半跳位），
 * 只把 preset 里没有的新机场按拼音序追加到末尾。
 */
export function mergeOriginOptions(preset: string[], fromApi: string[]): string[] {
  const existing = new Set(preset);
  const extra = fromApi.filter(item => item && !existing.has(item));
  return extra.length ? [...preset, ...Array.from(new Set(extra)).sort()] : preset;
}
