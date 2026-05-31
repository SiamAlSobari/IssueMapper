import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    plugins: [react()],
    base: '',
    build: {
        outDir: 'dist',
        cssCodeSplit: false,
        rollupOptions: {
            output: {
                manualChunks: undefined,
                entryFileNames: 'bundle.js',
                chunkFileNames: 'bundle.js',
                assetFileNames: 'bundle.[ext]',
            },
        },
    },
});
//# sourceMappingURL=vite.config.js.map