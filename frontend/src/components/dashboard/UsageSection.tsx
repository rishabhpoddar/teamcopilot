import { useEffect, useMemo, useState } from 'react';
import { AxiosError } from 'axios';
import { useAuth } from '../../lib/auth';
import { axiosInstance } from '../../utils';
import './UsageSection.css';

type UsageRange = '24h' | '7d' | '30d' | '90d';

type UsageBucket = {
    bucket_start: number;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    cost_usd: number;
    session_count: number;
};

type ModelUsage = {
    model_id: string;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
    cost_usd: number;
    session_count: number;
    pricing_available: boolean;
};

type PricingEntry = {
    input_per_million_usd: number;
    cached_input_per_million_usd: number;
    output_per_million_usd: number;
};

type UsageOverviewResponse = {
    range: UsageRange;
    estimated: boolean;
    summary: {
        total_input_tokens: number;
        total_output_tokens: number;
        total_cached_tokens: number;
        total_cost_usd: number;
        session_count: number;
    };
    timeseries: UsageBucket[];
    models: ModelUsage[];
    pricing: Record<string, PricingEntry>;
};

const RANGE_OPTIONS: UsageRange[] = ['24h', '7d', '30d', '90d'];

function formatTokenCount(value: number): string {
    return new Intl.NumberFormat(undefined, {
        notation: value >= 1000 ? 'compact' : 'standard',
        maximumFractionDigits: value >= 1000 ? 1 : 0,
    }).format(value);
}

function formatUsd(value: number): string {
    return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: value < 1 ? 4 : 2,
        maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);
}

function formatBucketLabel(timestamp: number, range: UsageRange): string {
    const date = new Date(timestamp);
    if (range === '24h') {
        return date.toLocaleTimeString([], { hour: 'numeric' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function SimpleBars({
    data,
    colorClass,
    valueKey,
}: {
    data: UsageBucket[];
    colorClass: string;
    valueKey: 'cost_usd' | 'input_tokens' | 'output_tokens' | 'cached_tokens';
}) {
    const maxValue = Math.max(...data.map((item) => item[valueKey]), 0);

    return (
        <div className="usage-bars">
            {data.map((item) => {
                const value = item[valueKey];
                const height = maxValue === 0 ? 6 : Math.max(6, (value / maxValue) * 100);
                return (
                    <div key={`${valueKey}-${item.bucket_start}`} className="usage-bar-column">
                        <div className={`usage-bar ${colorClass}`} style={{ height: `${height}%` }} />
                    </div>
                );
            })}
        </div>
    );
}

export default function UsageSection() {
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;
    const [range, setRange] = useState<UsageRange>('7d');
    const [data, setData] = useState<UsageOverviewResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!token) {
            return;
        }

        const fetchUsage = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await axiosInstance.get<UsageOverviewResponse>('/api/usage/overview', {
                    params: { range },
                    headers: { Authorization: `Bearer ${token}` }
                });
                setData(response.data);
            } catch (err: unknown) {
                const errorMessage = err instanceof AxiosError ? err.response?.data?.message || err.response?.data || err.message : 'Failed to load usage overview';
                setError(errorMessage);
            } finally {
                setLoading(false);
            }
        };

        void fetchUsage();
    }, [range, token]);

    const totalTokens = useMemo(() => {
        if (!data) {
            return 0;
        }
        return data.summary.total_input_tokens + data.summary.total_output_tokens + data.summary.total_cached_tokens;
    }, [data]);

    if (auth.loading) return null;

    if (loading) {
        return <div className="section-loading">Loading usage overview...</div>;
    }

    if (error) {
        return <div className="section-error">{error}</div>;
    }

    if (!data || data.summary.session_count === 0) {
        return (
            <div className="section-empty">
                <h3>No Usage Yet</h3>
                <p>Estimated token usage appears here after chat sessions complete.</p>
            </div>
        );
    }

    const shouldHideCosting = totalTokens > 0 && data.summary.total_cost_usd === 0;

    return (
        <section className="usage-section">
            <div className="usage-header">
                <div>
                    <h2>Usage Dashboard</h2>
                    <p className="usage-subtitle">
                        Team-wide estimated usage based on session totals. Some activity may be missed.
                    </p>
                </div>
                <div className="usage-range-picker" role="tablist" aria-label="Usage range">
                    {RANGE_OPTIONS.map((option) => (
                        <button
                            key={option}
                            type="button"
                            className={`usage-range-btn ${range === option ? 'active' : ''}`}
                            onClick={() => setRange(option)}
                        >
                            {option}
                        </button>
                    ))}
                </div>
            </div>

            <div className="usage-kpi-grid">
                {!shouldHideCosting ? (
                    <article className="usage-kpi-card">
                        <span className="usage-kpi-label">Estimated Cost</span>
                        <strong>{formatUsd(data.summary.total_cost_usd)}</strong>
                    </article>
                ) : null}
                <article className="usage-kpi-card">
                    <span className="usage-kpi-label">Total Tokens</span>
                    <strong>{formatTokenCount(totalTokens)}</strong>
                </article>
                <article className="usage-kpi-card">
                    <span className="usage-kpi-label">Input Tokens</span>
                    <strong>{formatTokenCount(data.summary.total_input_tokens)}</strong>
                </article>
                <article className="usage-kpi-card">
                    <span className="usage-kpi-label">Output Tokens</span>
                    <strong>{formatTokenCount(data.summary.total_output_tokens)}</strong>
                </article>
                <article className="usage-kpi-card">
                    <span className="usage-kpi-label">Cached Tokens</span>
                    <strong>{formatTokenCount(data.summary.total_cached_tokens)}</strong>
                </article>
                <article className="usage-kpi-card">
                    <span className="usage-kpi-label">Tracked Sessions</span>
                    <strong>{formatTokenCount(data.summary.session_count)}</strong>
                </article>
            </div>

            <div className="usage-chart-grid">
                {!shouldHideCosting ? (
                    <article className="usage-chart-card">
                        <div className="usage-chart-header">
                            <h3>Estimated Cost Over Time</h3>
                            <span>{formatUsd(data.summary.total_cost_usd)}</span>
                        </div>
                        <SimpleBars data={data.timeseries} valueKey="cost_usd" colorClass="cost" />
                        <div className="usage-axis-labels">
                            {data.timeseries.map((bucket) => (
                                <span key={`cost-label-${bucket.bucket_start}`}>{formatBucketLabel(bucket.bucket_start, data.range)}</span>
                            ))}
                        </div>
                    </article>
                ) : null}

                <article className="usage-chart-card">
                    <div className="usage-chart-header">
                        <h3>Token Usage Over Time</h3>
                        <span>{formatTokenCount(totalTokens)}</span>
                    </div>
                    <div className="usage-stacked-bars">
                        {data.timeseries.map((bucket) => {
                            const bucketTotal = bucket.input_tokens + bucket.output_tokens + bucket.cached_tokens;
                            const inputHeight = bucketTotal === 0 ? 0 : (bucket.input_tokens / bucketTotal) * 100;
                            const outputHeight = bucketTotal === 0 ? 0 : (bucket.output_tokens / bucketTotal) * 100;
                            const cachedHeight = bucketTotal === 0 ? 0 : (bucket.cached_tokens / bucketTotal) * 100;
                            return (
                                <div key={`tokens-${bucket.bucket_start}`} className="usage-bar-column">
                                    <div className="usage-stacked-bar">
                                        <div className="usage-stacked-segment input" style={{ height: `${inputHeight}%` }} />
                                        <div className="usage-stacked-segment output" style={{ height: `${outputHeight}%` }} />
                                        <div className="usage-stacked-segment cached" style={{ height: `${cachedHeight}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="usage-axis-labels">
                        {data.timeseries.map((bucket) => (
                            <span key={`token-label-${bucket.bucket_start}`}>{formatBucketLabel(bucket.bucket_start, data.range)}</span>
                        ))}
                    </div>
                    <div className="usage-legend">
                        <span><i className="input" />Input</span>
                        <span><i className="output" />Output</span>
                        <span><i className="cached" />Cached</span>
                    </div>
                </article>
            </div>

            <div className="usage-detail-grid">
                <article className="usage-panel">
                    <div className="usage-panel-header">
                        <h3>Model Breakdown</h3>
                    </div>
                    <div className="usage-table-wrap">
                        <table className="usage-table">
                            <thead>
                                <tr>
                                    <th>Model</th>
                                    <th>Sessions</th>
                                    <th>Input</th>
                                    <th>Output</th>
                                    <th>Cached</th>
                                    {!shouldHideCosting ? <th>Estimated Cost</th> : null}
                                </tr>
                            </thead>
                            <tbody>
                                {data.models.map((model) => (
                                    <tr key={model.model_id}>
                                        <td>
                                            <div className="usage-model-cell">
                                                <strong>{model.model_id}</strong>
                                                {!model.pricing_available ? <span>Pricing unavailable</span> : null}
                                            </div>
                                        </td>
                                        <td>{formatTokenCount(model.session_count)}</td>
                                        <td>{formatTokenCount(model.input_tokens)}</td>
                                        <td>{formatTokenCount(model.output_tokens)}</td>
                                        <td>{formatTokenCount(model.cached_tokens)}</td>
                                        {!shouldHideCosting ? <td>{formatUsd(model.cost_usd)}</td> : null}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </article>

                {!shouldHideCosting ? (
                    <article className="usage-panel">
                        <div className="usage-panel-header">
                            <h3>Pricing</h3>
                        </div>
                        <div className="usage-pricing-list">
                            {Object.entries(data.pricing).map(([modelId, pricingEntry]) => (
                                <div key={modelId} className="usage-pricing-card">
                                    <strong>{modelId}</strong>
                                    <span>Input: {formatUsd(pricingEntry.input_per_million_usd)}/1M</span>
                                    <span>Cached: {formatUsd(pricingEntry.cached_input_per_million_usd)}/1M</span>
                                    <span>Output: {formatUsd(pricingEntry.output_per_million_usd)}/1M</span>
                                </div>
                            ))}
                            {Object.keys(data.pricing).length === 0 ? (
                                <p className="usage-pricing-empty">No hard-coded pricing matched the models in this range.</p>
                            ) : null}
                        </div>
                    </article>
                ) : null}
            </div>
        </section>
    );
}
