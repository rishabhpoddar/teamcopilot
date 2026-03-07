import ApprovalReviewPage from './ApprovalReviewPage';
import { usePageTitle } from '../lib/usePageTitle';

export default function SkillApprovalReviewPage() {
    usePageTitle('Skill Approval');
    return <ApprovalReviewPage entity="skill" />;
}
