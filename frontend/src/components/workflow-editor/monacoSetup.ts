import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

type MonacoEnvironmentGlobal = typeof globalThis & {
    MonacoEnvironment?: {
        getWorker?: () => Worker;
    };
};

const globalScope = globalThis as MonacoEnvironmentGlobal;

if (!globalScope.MonacoEnvironment) {
    globalScope.MonacoEnvironment = {
        getWorker() {
            return new EditorWorker();
        }
    };
}
