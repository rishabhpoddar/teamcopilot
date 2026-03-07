import EditorPage from './EditorPage';
import { usePageTitle } from '../lib/usePageTitle';

export default function SkillEditorPage() {
    usePageTitle('Skill Editor');
    return <EditorPage entity="skill" />;
}
