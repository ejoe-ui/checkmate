// vite.config.js
import { defineConfig } from "file:///sessions/admiring-vigilant-volta/mnt/CheckMate/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/admiring-vigilant-volta/mnt/CheckMate/node_modules/@vitejs/plugin-react/dist/index.js";
import { VitePWA } from "file:///sessions/admiring-vigilant-volta/mnt/CheckMate/node_modules/vite-plugin-pwa/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "CheckMate",
        short_name: "CheckMate",
        description: "RHS Media Equipment Checkout",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "fullscreen",
        orientation: "landscape",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" }
        ]
      }
    })
  ]
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvYWRtaXJpbmctdmlnaWxhbnQtdm9sdGEvbW50L0NoZWNrTWF0ZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL2FkbWlyaW5nLXZpZ2lsYW50LXZvbHRhL21udC9DaGVja01hdGUvdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL2FkbWlyaW5nLXZpZ2lsYW50LXZvbHRhL21udC9DaGVja01hdGUvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IHsgVml0ZVBXQSB9IGZyb20gJ3ZpdGUtcGx1Z2luLXB3YSdcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW1xuICAgIHJlYWN0KCksXG4gICAgVml0ZVBXQSh7XG4gICAgICByZWdpc3RlclR5cGU6ICdhdXRvVXBkYXRlJyxcbiAgICAgIG1hbmlmZXN0OiB7XG4gICAgICAgIG5hbWU6ICdDaGVja01hdGUnLFxuICAgICAgICBzaG9ydF9uYW1lOiAnQ2hlY2tNYXRlJyxcbiAgICAgICAgZGVzY3JpcHRpb246ICdSSFMgTWVkaWEgRXF1aXBtZW50IENoZWNrb3V0JyxcbiAgICAgICAgdGhlbWVfY29sb3I6ICcjMWExYTJlJyxcbiAgICAgICAgYmFja2dyb3VuZF9jb2xvcjogJyMxYTFhMmUnLFxuICAgICAgICBkaXNwbGF5OiAnZnVsbHNjcmVlbicsXG4gICAgICAgIG9yaWVudGF0aW9uOiAnbGFuZHNjYXBlJyxcbiAgICAgICAgaWNvbnM6IFtcbiAgICAgICAgICB7IHNyYzogJy9pY29uLTE5Mi5wbmcnLCBzaXplczogJzE5MngxOTInLCB0eXBlOiAnaW1hZ2UvcG5nJyB9LFxuICAgICAgICAgIHsgc3JjOiAnL2ljb24tNTEyLnBuZycsIHNpemVzOiAnNTEyeDUxMicsIHR5cGU6ICdpbWFnZS9wbmcnIH1cbiAgICAgICAgXVxuICAgICAgfVxuICAgIH0pXG4gIF1cbn0pXG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQStULFNBQVMsb0JBQW9CO0FBQzVWLE9BQU8sV0FBVztBQUNsQixTQUFTLGVBQWU7QUFFeEIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUztBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sUUFBUTtBQUFBLE1BQ04sY0FBYztBQUFBLE1BQ2QsVUFBVTtBQUFBLFFBQ1IsTUFBTTtBQUFBLFFBQ04sWUFBWTtBQUFBLFFBQ1osYUFBYTtBQUFBLFFBQ2IsYUFBYTtBQUFBLFFBQ2Isa0JBQWtCO0FBQUEsUUFDbEIsU0FBUztBQUFBLFFBQ1QsYUFBYTtBQUFBLFFBQ2IsT0FBTztBQUFBLFVBQ0wsRUFBRSxLQUFLLGlCQUFpQixPQUFPLFdBQVcsTUFBTSxZQUFZO0FBQUEsVUFDNUQsRUFBRSxLQUFLLGlCQUFpQixPQUFPLFdBQVcsTUFBTSxZQUFZO0FBQUEsUUFDOUQ7QUFBQSxNQUNGO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
