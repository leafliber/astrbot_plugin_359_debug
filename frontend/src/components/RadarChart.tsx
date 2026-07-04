import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

export interface RadarData {
  runtime: number;
  token: number;
  context: number;
  tool: number;
  log: number;
  plugin: number;
}

export interface RadarChartProps {
  data: Partial<RadarData>;
}

const DIMENSIONS: { key: keyof RadarData; label: string; color: string }[] = [
  { key: 'runtime', label: '运行时', color: '#4CAF50' },
  { key: 'token', label: 'Token', color: '#2196F3' },
  { key: 'context', label: '上下文', color: '#FF9800' },
  { key: 'tool', label: '工具', color: '#9C27B0' },
  { key: 'log', label: '日志', color: '#f44336' },
  { key: 'plugin', label: '插件', color: '#00BCD4' },
];

export default function RadarChart({ data }: RadarChartProps) {
  const chartData = DIMENSIONS.map((dim) => ({
    dimension: dim.label,
    score: typeof data[dim.key] === 'number' ? (data[dim.key] as number) : 0,
    color: dim.color,
  }));

  return (
    <div className="radar-container">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsRadarChart
          data={chartData}
          outerRadius="72%"
          margin={{ top: 16, right: 30, bottom: 16, left: 30 }}
        >
          <PolarGrid stroke="#2a2f4e" />
          <PolarAngleAxis
            dataKey="dimension"
            tick={{ fill: '#a0a8c0', fontSize: 12 }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tickCount={5}
            tick={{ fill: '#6b7390', fontSize: 10 }}
            axisLine={false}
          />
          <Radar
            name="健康分"
            dataKey="score"
            stroke="#4CAF50"
            strokeWidth={2}
            fill="#4CAF50"
            fillOpacity={0.25}
          />
          <Tooltip
            contentStyle={{
              background: '#16213e',
              border: '1px solid #2a2f4e',
              borderRadius: '8px',
              color: '#e0e0e0',
              fontSize: '12px',
            }}
            labelStyle={{ color: '#a0a8c0' }}
          />
        </RechartsRadarChart>
      </ResponsiveContainer>
    </div>
  );
}
