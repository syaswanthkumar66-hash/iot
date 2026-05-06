import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
import process from 'process';
import { registerRootComponent } from 'expo';
import App from './App';

global.Buffer = global.Buffer || Buffer;
global.process = global.process || process;

registerRootComponent(App);
