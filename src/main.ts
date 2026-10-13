import './ui/style.css';
import { App } from './app';
import { TitleScreen } from './ui/screens/menus';

const app = new App();
app.push(new TitleScreen(app));
(window as any).scrapClub = app;
