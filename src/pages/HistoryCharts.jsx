/** 历史页图表（独立 chunk：recharts 经 React.lazy 动态加载，不进主包）。 */
import React from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { IconChart } from '../components/Icon.jsx';
import { formatNumber } from '../lib/util.js';

function ChartTooltip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <b>{label}</b>
      {payload.map((p) => (
        <div key={p.dataKey}>
          {p.name}：{formatNumber(p.value)}
          {unit || ''}
        </div>
      ))}
    </div>
  );
}

export default function HistoryCharts({ daily }) {
  const tickInterval = Math.max(0, Math.floor(daily.length / 8));
  return (
    <>
      <div className="chart-wrap">
        <div className="chart-title">
          <IconChart size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          最近 30 天调用趋势
        </div>
        <ResponsiveContainer width="100%" height={168}>
          <AreaChart data={daily} margin={{ top: 12, right: 8, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="gSearch" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.55} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.04} />
              </linearGradient>
              <linearGradient id="gFetch" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-2)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--accent-2)" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} interval={tickInterval} />
            <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} />
            <Tooltip content={<ChartTooltip unit=" 次" />} />
            <Area type="monotone" dataKey="搜索" stroke="var(--accent)" fill="url(#gSearch)" strokeWidth={2} />
            <Area type="monotone" dataKey="抓取" stroke="var(--accent-2)" fill="url(#gFetch)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-wrap">
        <div className="chart-title">每日召回结果条数</div>
        <ResponsiveContainer width="100%" height={132}>
          <BarChart data={daily} margin={{ top: 10, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} interval={tickInterval} />
            <YAxis tickLine={false} axisLine={false} width={44} allowDecimals={false} />
            <Tooltip content={<ChartTooltip unit=" 条" />} />
            <Bar dataKey="结果" radius={[3, 3, 0, 0]}>
              {daily.map((d, i) => (
                <Cell key={d.key} fill={i === daily.length - 1 ? 'var(--accent)' : 'var(--accent-2)'} fillOpacity={0.75} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
