import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { chartColors } from '../theme-utils';

export interface RadarData {
  runtime: number;
  token: number;
  context: number;
  tool: number;
  log: number;
  plugin: number;
  lock: number;
}

export interface RadarChartProps {
  data: Partial<RadarData>;
}

const DIMENSIONS: { key: keyof RadarData; label: string }[] = [
  { key: 'runtime', label: '运行时' },
  { key: 'token', label: 'Token' },
  { key: 'context', label: '上下文' },
  { key: 'tool', label: '工具' },
  { key: 'log', label: '日志' },
  { key: 'plugin', label: '插件' },
  { key: 'lock', label: '会话锁' },
];

export default function RadarChart({ data }: RadarChartProps) {
  const chartData = DIMENSIONS.map((dim) => ({
    dimension: dim.label,
    score: typeof data[dim.key] === 'number' ? (data[dim.key] as number) : 0,
  }));

  const c = chartColors();

  return (
    <div className="radar-container">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsRadarChart
          data={chartData}
          outerRadius="72%"
          margin={{ top: 16, right: 30, bottom: 16, left: 30 }}
        >
          <PolarGrid stroke={c.grid} />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fill: c.tickSecondary, fontSize: 12 }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tickCount={5}
            tick={{ fill: c.tickMuted, fontSize: 10 }}
            axisLine={false}
          />
          <Radar
            name="日常分"
            dataKey="score"
            stroke={c.primary}
            strokeWidth={2}
            fill={c.primary}
            fillOpacity={0.25}
          />
          <Tooltip
            contentStyle={{
              background: c.cardBg,
              border: `1px solid ${c.borderColor}`,
              borderRadius: '8px',
              color: c.textPrimary,
              fontSize: '12px',
            }}
            labelStyle={{ color: c.tickSecondary }}
          />
        </RechartsRadarChart>
      </ResponsiveContainer>
    </div>
  );
}
