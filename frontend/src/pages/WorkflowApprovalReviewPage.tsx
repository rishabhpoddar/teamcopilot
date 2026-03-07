import ApprovalReviewPage from './ApprovalReviewPage';
import { usePageTitle } from '../lib/usePageTitle';

export default function WorkflowApprovalReviewPage() {
    usePageTitle('Workflow Approval');
    return <ApprovalReviewPage entity="workflow" />;
}
