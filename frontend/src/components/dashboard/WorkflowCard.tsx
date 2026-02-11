import { Workflow } from '../../types/workflow';

export default function WorkflowCard({ name, intent_summary }: Workflow) {
    return (
        <div className="workflow-card">
            <div className="workflow-card-header">
                <h3 className="workflow-card-title">{name}</h3>
            </div>
            {intent_summary && <p className="workflow-card-description">{intent_summary}</p>}
            <button className="workflow-card-run-btn">Run Workflow</button>
        </div>
    );
}
