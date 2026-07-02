import "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
var vite_config_default = defineConfig({ plugins: [react(), VitePWA({
	registerType: "autoUpdate",
	manifest: {
		name: "CheckMate",
		short_name: "CheckMate",
		description: "RHS Media Equipment Checkout",
		theme_color: "#1a1a2e",
		background_color: "#1a1a2e",
		display: "fullscreen",
		orientation: "landscape",
		icons: [{
			src: "/icon-192.png",
			sizes: "192x192",
			type: "image/png"
		}, {
			src: "/icon-512.png",
			sizes: "512x512",
			type: "image/png"
		}]
	}
})] });
//#endregion
export { vite_config_default as default };

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidml0ZS5jb25maWcuanMiLCJuYW1lcyI6W10sInNvdXJjZXMiOlsiL3Nlc3Npb25zL2FkbWlyaW5nLXZpZ2lsYW50LXZvbHRhL21udC9DaGVja01hdGUvdml0ZS5jb25maWcuanMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSdcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCdcbmltcG9ydCB7IFZpdGVQV0EgfSBmcm9tICd2aXRlLXBsdWdpbi1wd2EnXG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtcbiAgICByZWFjdCgpLFxuICAgIFZpdGVQV0Eoe1xuICAgICAgcmVnaXN0ZXJUeXBlOiAnYXV0b1VwZGF0ZScsXG4gICAgICBtYW5pZmVzdDoge1xuICAgICAgICBuYW1lOiAnQ2hlY2tNYXRlJyxcbiAgICAgICAgc2hvcnRfbmFtZTogJ0NoZWNrTWF0ZScsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnUkhTIE1lZGlhIEVxdWlwbWVudCBDaGVja291dCcsXG4gICAgICAgIHRoZW1lX2NvbG9yOiAnIzFhMWEyZScsXG4gICAgICAgIGJhY2tncm91bmRfY29sb3I6ICcjMWExYTJlJyxcbiAgICAgICAgZGlzcGxheTogJ2Z1bGxzY3JlZW4nLFxuICAgICAgICBvcmllbnRhdGlvbjogJ2xhbmRzY2FwZScsXG4gICAgICAgIGljb25zOiBbXG4gICAgICAgICAgeyBzcmM6ICcvaWNvbi0xOTIucG5nJywgc2l6ZXM6ICcxOTJ4MTkyJywgdHlwZTogJ2ltYWdlL3BuZycgfSxcbiAgICAgICAgICB7IHNyYzogJy9pY29uLTUxMi5wbmcnLCBzaXplczogJzUxMng1MTInLCB0eXBlOiAnaW1hZ2UvcG5nJyB9XG4gICAgICAgIF1cbiAgICAgIH1cbiAgICB9KVxuICBdXG59KVxuIl0sIm1hcHBpbmdzIjoiOzs7O0FBSUEsSUFBQSxzQkFBZSxhQUFhLEVBQzFCLFNBQVMsQ0FDUCxNQUFNLEdBQ04sUUFBUTtDQUNOLGNBQWM7Q0FDZCxVQUFVO0VBQ1IsTUFBTTtFQUNOLFlBQVk7RUFDWixhQUFhO0VBQ2IsYUFBYTtFQUNiLGtCQUFrQjtFQUNsQixTQUFTO0VBQ1QsYUFBYTtFQUNiLE9BQU8sQ0FDTDtHQUFFLEtBQUs7R0FBaUIsT0FBTztHQUFXLE1BQU07RUFBWSxHQUM1RDtHQUFFLEtBQUs7R0FBaUIsT0FBTztHQUFXLE1BQU07RUFBWSxDQUM5RDtDQUNGO0FBQ0YsQ0FBQyxDQUNILEVBQ0YsQ0FBQyJ9