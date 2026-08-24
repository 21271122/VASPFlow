/**
 * dsh-vaspflow client: convergence chart — port of ConvergenceChart.tsx
 * (recharts dual-axis line chart, relative/absolute energy toggle).
 */
import React, { useEffect, useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Spin, Empty, Switch } from 'antd';
import { fetchConvergence } from './api';

const ConvergenceChart: React.FC<{ taskId: number }> = ({ taskId }) => {
  const [data, setData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const [logEnergy, setLogEnergy] = useState(false);

  useEffect(() => {
    setLoading(true);
    setData(null);
    setErrorMsg(null);
    fetchConvergence(taskId)
      .then((response) => {
        if (response.error || !response.ion_steps?.length) {
          setErrorMsg(response.error || '数据为空');
          return;
        }
        const { ion_steps, energies, max_forces, _source } = response;
        setSource(_source || `${ion_steps.length} 个离子步`);
        const chartData = ion_steps.map((step: number, i: number) => ({
          step,
          energy: energies[i] ?? null,
          force: max_forces[i] ?? null,
        }));
        setData(chartData);
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [taskId]);

  const relData = useMemo(() => {
    if (!data || data.length === 0) return data;
    const refEnergy = data[data.length - 1].energy;
    if (refEnergy == null) return data;
    return data.map((d) => ({
      ...d,
      energy: logEnergy ? d.energy : d.energy - refEnergy,
    }));
  }, [data, logEnergy]);

  if (loading) return <Spin style={{ display: 'block', margin: '60px auto' }} />;
  if (errorMsg) return <Empty description={`无收敛数据: ${errorMsg}`} />;
  if (!data || data.length === 0) return <Empty description="无收敛数据（需 OSZICAR + OUTCAR）" />;

  const energyLabel = logEnergy ? '绝对能量 (eV)' : '相对能量 ΔE (eV)';

  return (
    <div>
      <div style={{ marginBottom: 2, fontSize: 11, color: 'var(--dsw-alias-label-tertiary, #999)' }}>
        数据来源: {source}
      </div>
      <div style={{ marginBottom: 4 }}>
        <Switch size="small" checked={logEnergy} onChange={setLogEnergy} />
        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #888)' }}>
          {logEnergy ? '绝对能量' : '相对能量（相对最后一步）'}
        </span>
      </div>
      <div style={{ width: '100%', height: 340 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={relData ?? undefined} margin={{ top: 8, right: 24, left: 16, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--dsw-alias-border-l2, #f0f0f0)" />
            <XAxis
              dataKey="step"
              label={{ value: '离子步', position: 'insideBottomRight', offset: -4 }}
            />
            <YAxis
              yAxisId="energy"
              label={{ value: energyLabel, angle: -90, position: 'insideLeft' }}
              tickFormatter={(v) => (logEnergy ? v.toFixed(2) : v.toExponential(1))}
            />
            <YAxis
              yAxisId="force"
              orientation="right"
              label={{ value: '最大力 (eV/Å)', angle: 90, position: 'insideRight' }}
              tickFormatter={(v) => v.toFixed(3)}
            />
            <Tooltip
              formatter={(value: any, name: string) => {
                const num = Number(value);
                const isEnergy = name.includes('能量');
                return [num.toFixed(6), isEnergy ? name : '最大力 (eV/Å)'];
              }}
            />
            <Legend />
            <Line
              yAxisId="energy"
              type="monotone"
              dataKey="energy"
              stroke="#8884d8"
              strokeWidth={2}
              dot={{ r: 3 }}
              name={energyLabel}
              connectNulls
            />
            <Line
              yAxisId="force"
              type="monotone"
              dataKey="force"
              stroke="#82ca9d"
              strokeWidth={2}
              dot={{ r: 3 }}
              name="最大力"
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ConvergenceChart;
