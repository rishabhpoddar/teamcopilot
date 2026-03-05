import { useNavigate } from 'react-router-dom';
import './OpencodeAuthComplete.css';

export default function OpencodeAuthComplete() {
    const navigate = useNavigate();

    return (
        <div className="opencode-auth-complete-page">
            <section className="opencode-auth-complete-card">
                <h1>Authentication Complete</h1>
                <p>Your model credentials are configured successfully.</p>
                <button type="button" onClick={() => navigate('/')}>Continue to dashboard</button>
            </section>
        </div>
    );
}
