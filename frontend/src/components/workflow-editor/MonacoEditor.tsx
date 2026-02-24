import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import './monacoSetup';

interface MonacoEditorProps {
    value: string;
    readOnly: boolean;
    language: string;
    onChange: (value: string) => void;
}

function useColorScheme(): 'light' | 'dark' {
    const [colorScheme, setColorScheme] = useState<'light' | 'dark'>(() => {
        if (typeof window === 'undefined') return 'dark';
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    });

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
        const handler = (e: MediaQueryListEvent) => {
            setColorScheme(e.matches ? 'light' : 'dark');
        };
        mediaQuery.addEventListener('change', handler);
        return () => mediaQuery.removeEventListener('change', handler);
    }, []);

    return colorScheme;
}

export default function MonacoEditor({ value, readOnly, language, onChange }: MonacoEditorProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const changeSubscriptionRef = useRef<monaco.IDisposable | null>(null);
    const onChangeRef = useRef(onChange);
    const colorScheme = useColorScheme();

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    useEffect(() => {
        if (!containerRef.current) return;

        const theme = colorScheme === 'light' ? 'vs' : 'vs-dark';
        const editor = monaco.editor.create(containerRef.current, {
            value,
            language,
            theme,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            readOnly,
            scrollBeyondLastLine: false,
        });
        editorRef.current = editor;
        changeSubscriptionRef.current = editor.onDidChangeModelContent(() => {
            onChangeRef.current(editor.getValue());
        });

        return () => {
            changeSubscriptionRef.current?.dispose();
            editorRef.current?.dispose();
            changeSubscriptionRef.current = null;
            editorRef.current = null;
        };
    }, []);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        if (editor.getValue() !== value) {
            editor.setValue(value);
        }
    }, [value]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.updateOptions({ readOnly });
    }, [readOnly]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const model = editor.getModel();
        if (!model) return;
        monaco.editor.setModelLanguage(model, language);
    }, [language]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor) return;
        const theme = colorScheme === 'light' ? 'vs' : 'vs-dark';
        editor.updateOptions({ theme });
    }, [colorScheme]);

    return <div ref={containerRef} className="workflow-monaco-editor" />;
}
