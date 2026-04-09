import { useEffect, useMemo, useState, type ReactNode } from 'react';
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

function formatKpiTokenCount(value: number): string {
    return new Intl.NumberFormat(undefined, {
        notation: value >= 1000 ? 'compact' : 'standard',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
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

function formatBucketDateTime(timestamp: number, range: UsageRange): string {
    const date = new Date(timestamp);
    if (range === '24h') {
        return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function ChartScroller({
    children,
    points,
}: {
    children: ReactNode;
    points: number;
}) {
    const minWidth = Math.max(360, points * 56);
    return (
        <div className="usage-chart-scroll">
            <div className="usage-chart-scroll-inner" style={{ minWidth: `${minWidth}px` }}>
                {children}
            </div>
        </div>
    );
}

function CostBars({
    data,
    range,
    selectedBucketStart,
    onSelectBucket,
}: {
    data: UsageBucket[];
    range: UsageRange;
    selectedBucketStart: number;
    onSelectBucket: (bucketStart: number) => void;
}) {
    const maxValue = Math.max(...data.map((item) => item.cost_usd), 0);
    const gridTemplateColumns = `repeat(${Math.max(data.length, 1)}, minmax(32px, 1fr))`;

    if (maxValue === 0) {
        return <div className="usage-chart-empty">No cost recorded in this time range.</div>;
    }

    return (
        <ChartScroller points={data.length}>
            <div className="usage-bars" style={{ gridTemplateColumns }}>
                {data.map((item) => {
                    const value = item.cost_usd;
                    const height = (value / maxValue) * 100;
                    const isSelected = selectedBucketStart === item.bucket_start;
                    return (
                        <div key={`cost-${item.bucket_start}`} className="usage-bar-column">
                            <div className="usage-bar-rail">
                                <button
                                    type="button"
                                    className={`usage-bar-button ${isSelected ? 'selected' : ''}`}
                                    onClick={() => onSelectBucket(item.bucket_start)}
                                    aria-label={`Show cost details for ${formatBucketDateTime(item.bucket_start, range)}`}
                                >
                                    <div className="usage-bar cost" style={{ height: `${height}%` }} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="usage-axis-labels" style={{ gridTemplateColumns }}>
                {data.map((bucket) => (
                    <span key={`cost-label-${bucket.bucket_start}`}>{formatBucketLabel(bucket.bucket_start, range)}</span>
                ))}
            </div>
        </ChartScroller>
    );
}

function TokenBars({
    data,
    range,
    selectedBucketStart,
    onSelectBucket,
}: {
    data: UsageBucket[];
    range: UsageRange;
    selectedBucketStart: number;
    onSelectBucket: (bucketStart: number) => void;
}) {
    const totals = data.map((bucket) => bucket.input_tokens + bucket.output_tokens + bucket.cached_tokens);
    const maxTotal = Math.max(...totals, 0);
    const gridTemplateColumns = `repeat(${Math.max(data.length, 1)}, minmax(32px, 1fr))`;

    if (maxTotal === 0) {
        return <div className="usage-chart-empty">No token activity recorded in this time range.</div>;
    }

    return (
        <ChartScroller points={data.length}>
            <div className="usage-bars" style={{ gridTemplateColumns }}>
                {data.map((item) => {
                    const bucketTotal = item.input_tokens + item.output_tokens + item.cached_tokens;
                    const stackHeight = (bucketTotal / maxTotal) * 100;
                    const inputHeight = bucketTotal === 0 ? 0 : (item.input_tokens / bucketTotal) * 100;
                    const outputHeight = bucketTotal === 0 ? 0 : (item.output_tokens / bucketTotal) * 100;
                    const cachedHeight = bucketTotal === 0 ? 0 : (item.cached_tokens / bucketTotal) * 100;
                    const isSelected = selectedBucketStart === item.bucket_start;
                    return (
                        <div key={`tokens-${item.bucket_start}`} className="usage-bar-column">
                            <div className="usage-bar-rail">
                                <button
                                    type="button"
                                    className={`usage-bar-button ${isSelected ? 'selected' : ''}`}
                                    onClick={() => onSelectBucket(item.bucket_start)}
                                    aria-label={`Show token details for ${formatBucketDateTime(item.bucket_start, range)}`}
                                >
                                    <div className="usage-stacked-bar" style={{ height: `${stackHeight}%` }}>
                                        <div className="usage-stacked-segment input" style={{ height: `${inputHeight}%` }} />
                                        <div className="usage-stacked-segment output" style={{ height: `${outputHeight}%` }} />
                                        <div className="usage-stacked-segment cached" style={{ height: `${cachedHeight}%` }} />
                                    </div>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="usage-axis-labels" style={{ gridTemplateColumns }}>
                {data.map((bucket) => (
                    <span key={`token-label-${bucket.bucket_start}`}>{formatBucketLabel(bucket.bucket_start, range)}</span>
                ))}
            </div>
        </ChartScroller>
    );
}

export default function UsageSection() {
    const auth = useAuth();
    const token = auth.loading ? null : auth.token;
    const [range, setRange] = useState<UsageRange>('7d');
    const [data, setData] = useState<UsageOverviewResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedCostBucketStart, setSelectedCostBucketStart] = useState<number | null>(null);
    const [selectedTokenBucketStart, setSelectedTokenBucketStart] = useState<number | null>(null);

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
                const defaultBucketStart = response.data.timeseries.at(-1)?.bucket_start ?? null;
                setSelectedCostBucketStart(defaultBucketStart);
                setSelectedTokenBucketStart(defaultBucketStart);
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
        return null;
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
    const selectedCostBucket = data.timeseries.find((bucket) => bucket.bucket_start === selectedCostBucketStart) ?? data.timeseries.at(-1) ?? null;
    const selectedTokenBucket = data.timeseries.find((bucket) => bucket.bucket_start === selectedTokenBucketStart) ?? data.timeseries.at(-1) ?? null;

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
                        <strong>{new Intl.NumberFormat(undefined, {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        }).format(data.summary.total_cost_usd)}</strong>
                    </article>
                ) : null}
                <article className="usage-kpi-card">
                    <span className="usage-kpi-label">Total Tokens</span>
                    <strong>{formatKpiTokenCount(totalTokens)}</strong>
                </article>
                <article className="usage-kpi-card">
                    <span className="usage-kpi-label">Input Tokens</span>
                    <strong>{formatKpiTokenCount(data.summary.total_input_tokens)}</strong>
                </article>
                <article className="usage-kpi-card">
                    <span className="usage-kpi-label">Output Tokens</span>
                    <strong>{formatKpiTokenCount(data.summary.total_output_tokens)}</strong>
                </article>
                <article className="usage-kpi-card">
                    <span className="usage-kpi-label">Cached Tokens</span>
                    <strong>{formatKpiTokenCount(data.summary.total_cached_tokens)}</strong>
                </article>
                <article className="usage-kpi-card">
                    <span className="usage-kpi-label">Tracked Sessions</span>
                    <strong>{formatKpiTokenCount(data.summary.session_count)}</strong>
                </article>
            </div>

            <div className="usage-chart-grid">
                {!shouldHideCosting ? (
                    <article className="usage-chart-card">
                        <div className="usage-chart-header">
                            <h3>Estimated Cost Over Time</h3>
                            <span>{formatUsd(data.summary.total_cost_usd)}</span>
                        </div>
                        <CostBars
                            data={data.timeseries}
                            range={data.range}
                            selectedBucketStart={selectedCostBucket?.bucket_start ?? 0}
                            onSelectBucket={setSelectedCostBucketStart}
                        />
                        {selectedCostBucket ? (
                            <div className="usage-chart-selection">
                                <strong>{formatBucketDateTime(selectedCostBucket.bucket_start, data.range)}</strong>
                                <div className="usage-chart-selection-grid">
                                    <span>Cost: {formatUsd(selectedCostBucket.cost_usd)}</span>
                                    <span>Sessions: {formatTokenCount(selectedCostBucket.session_count)}</span>
                                </div>
                            </div>
                        ) : null}
                    </article>
                ) : null}

                <article className="usage-chart-card">
                        <div className="usage-chart-header">
                            <h3>Token Usage Over Time</h3>
                            <span>{formatTokenCount(totalTokens)}</span>
                        </div>
                    <TokenBars
                        data={data.timeseries}
                        range={data.range}
                        selectedBucketStart={selectedTokenBucket?.bucket_start ?? 0}
                        onSelectBucket={setSelectedTokenBucketStart}
                    />
                    {selectedTokenBucket ? (
                        <div className="usage-chart-selection">
                            <strong>{formatBucketDateTime(selectedTokenBucket.bucket_start, data.range)}</strong>
                            <div className="usage-chart-selection-grid">
                                <span>Input: {formatTokenCount(selectedTokenBucket.input_tokens)}</span>
                                <span>Output: {formatTokenCount(selectedTokenBucket.output_tokens)}</span>
                                <span>Cached: {formatTokenCount(selectedTokenBucket.cached_tokens)}</span>
                                <span>Sessions: {formatTokenCount(selectedTokenBucket.session_count)}</span>
                            </div>
                        </div>
                    ) : null}
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
                                        <td data-label="Model">
                                            <div className="usage-model-cell">
                                                <strong>{model.model_id}</strong>
                                                {!model.pricing_available ? <span>Pricing unavailable</span> : null}
                                            </div>
                                        </td>
                                        <td data-label="Sessions">{formatTokenCount(model.session_count)}</td>
                                        <td data-label="Input">{formatTokenCount(model.input_tokens)}</td>
                                        <td data-label="Output">{formatTokenCount(model.output_tokens)}</td>
                                        <td data-label="Cached">{formatTokenCount(model.cached_tokens)}</td>
                                        {!shouldHideCosting ? <td data-label="Estimated Cost">{formatUsd(model.cost_usd)}</td> : null}
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
                                    <div className="usage-pricing-card-header">
                                        <strong>{modelId}</strong>
                                        <span>Per 1M tokens</span>
                                    </div>
                                    <div className="usage-pricing-rate-list">
                                        <div className="usage-pricing-rate-row">
                                            <span>Input</span>
                                            <strong>{formatUsd(pricingEntry.input_per_million_usd)}</strong>
                                        </div>
                                        <div className="usage-pricing-rate-row">
                                            <span>Cached</span>
                                            <strong>{formatUsd(pricingEntry.cached_input_per_million_usd)}</strong>
                                        </div>
                                        <div className="usage-pricing-rate-row">
                                            <span>Output</span>
                                            <strong>{formatUsd(pricingEntry.output_per_million_usd)}</strong>
                                        </div>
                                    </div>
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
