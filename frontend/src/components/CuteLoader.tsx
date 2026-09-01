import './CuteLoader.css';

interface CuteLoaderProps {
  size?: number;
  text?: string;
}

const LEGS = [
  { x1: 30, y1: 58, x2: 10, y2: 48, phase: 'a' },
  { x1: 30, y1: 62, x2: 8, y2: 62, phase: 'b' },
  { x1: 30, y1: 66, x2: 10, y2: 76, phase: 'a' },
  { x1: 70, y1: 58, x2: 90, y2: 48, phase: 'b' },
  { x1: 70, y1: 62, x2: 92, y2: 62, phase: 'a' },
  { x1: 70, y1: 66, x2: 90, y2: 76, phase: 'b' },
];

// 复用 logo.svg 的猫蜘蛛形象做成爬取中的动效：呼应"爬虫"的爬，六条腿分两组交替摆动模拟爬行，身体轻微起伏
function CuteLoader({ size = 64, text }: CuteLoaderProps) {
  return (
    <div className="cute-loader" style={{ width: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="cute-loader__svg">
        <g className="cute-loader__bounce">
          {LEGS.map((leg, i) => (
            <g
              key={i}
              className={`cute-loader__leg cute-loader__leg--${leg.phase}`}
              style={{ transformOrigin: `${leg.x1}px ${leg.y1}px` }}
            >
              <line x1={leg.x1} y1={leg.y1} x2={leg.x2} y2={leg.y2} stroke="#555" strokeWidth={2} strokeLinecap="round" />
            </g>
          ))}

          <ellipse cx="50" cy="75" rx="12" ry="14" fill="#4a4a6a" stroke="#333" strokeWidth={1.5} />
          <ellipse cx="50" cy="75" rx="6" ry="8" fill="#6a5acd" opacity={0.6} />

          <circle cx="50" cy="50" r="22" fill="#f5c07a" stroke="#d4956a" strokeWidth={1.5} />

          <polygon points="32,32 28,14 42,28" fill="#f5c07a" stroke="#d4956a" strokeWidth={1.5} />
          <polygon points="68,32 72,14 58,28" fill="#f5c07a" stroke="#d4956a" strokeWidth={1.5} />
          <polygon points="33,30 30,18 41,28" fill="#f0a0a0" />
          <polygon points="67,30 70,18 59,28" fill="#f0a0a0" />

          <ellipse cx="41" cy="50" rx="6" ry="7" fill="white" />
          <ellipse cx="59" cy="50" rx="6" ry="7" fill="white" />
          <g className="cute-loader__blink">
            <ellipse cx="41" cy="50" rx="2.5" ry="5" fill="#1a1a2e" />
            <ellipse cx="59" cy="50" rx="2.5" ry="5" fill="#1a1a2e" />
          </g>
          <circle cx="42.5" cy="47.5" r="1.2" fill="white" />
          <circle cx="60.5" cy="47.5" r="1.2" fill="white" />

          <polygon points="50,56 47.5,59 52.5,59" fill="#e88080" />
          <path d="M47.5,59 Q50,62 52.5,59" stroke="#c06060" strokeWidth={1.2} fill="none" />
          <line x1="30" y1="57" x2="44" y2="58" stroke="#888" strokeWidth={1} strokeLinecap="round" />
          <line x1="30" y1="60" x2="44" y2="60" stroke="#888" strokeWidth={1} strokeLinecap="round" />
          <line x1="70" y1="57" x2="56" y2="58" stroke="#888" strokeWidth={1} strokeLinecap="round" />
          <line x1="70" y1="60" x2="56" y2="60" stroke="#888" strokeWidth={1} strokeLinecap="round" />
        </g>
      </svg>
      {text && <div className="cute-loader__text">{text}</div>}
    </div>
  );
}

export default CuteLoader;
