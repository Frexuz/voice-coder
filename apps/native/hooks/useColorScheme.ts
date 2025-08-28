// Force dark mode across the app on native platforms
// Return type matches React Native's `useColorScheme` hook
export function useColorScheme(): 'light' | 'dark' | null {
	return 'dark';
}
