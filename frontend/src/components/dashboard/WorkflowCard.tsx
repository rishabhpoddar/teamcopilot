interface WorkflowCardProps {
    slug: string;
    name: string;
    description?: string;
    version?: string;
}

export default function WorkflowCard({ name, description, version }: WorkflowCardProps) {
    return (
        <div className="workflow-card">
            <div className="workflow-card-header">
                <h3 className="workflow-card-title">{name}</h3>
                {version && <span className="workflow-card-version">v{version}</span>}
            </div>
            {description && <p className="workflow-card-description">{description}</p>}
            <button className="workflow-card-run-btn">Run Workflow</button>
        </div>
    );
}
