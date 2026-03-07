import EditorPage from './EditorPage';
import { usePageTitle } from '../lib/usePageTitle';

export default function WorkflowEditorPage() {
    usePageTitle('Workflow Editor');
    return <EditorPage entity="workflow" />;
}
