import fs from 'node:fs';
import config from './translate/config.js';

const baseUrl = 'https://libretranslate.com';
const mcmLanguages = {
	en: 'ENGLISH',
	de: 'GERMAN',
	fr: 'FRENCH',
	it: 'ITALIAN',
	pl: 'POLISH',
	ru: 'RUSSIAN',
	zt: 'CHINESE',
};
const apiKeys = config.apiKeys;
const nextRequest = {};
let currentAPIKey = Object.keys(apiKeys)[0];
const wait = async(factor = 1) => {
	const now = Date.now();
	nextRequest[currentAPIKey] = now + factor * apiKeys[currentAPIKey] * 1.5 + Math.round(Math.random() * 100);
	for (const apiKey of Object.keys(apiKeys)) {
		apiKeys[apiKey] += factor * factor;
	}
	const nextTime = Math.min(...Object.values(nextRequest));
	for (const key of Object.keys(apiKeys)) {
		if (nextRequest[key] === nextTime) {
			currentAPIKey = key;
			break;
		}
	}
	let delay = nextTime - now;
	if (delay < 1) {
		delay = 1;
	}
	return new Promise(resolve => setTimeout(
		resolve,
		delay
	));
};
const delay = (factor) => {
	for (const apiKey of Object.keys(apiKeys)) {
		apiKeys[apiKey] += factor * factor;
	}
	return new Promise(resolve => setTimeout(
		resolve,
		factor * factor + 1
	));
}

for (const key of Object.keys(apiKeys)) {
	nextRequest[key] = Date.now();
}

const handler = [() => {}, false];
const handleWrite = () => {
	if (handler[1]) {
		handler[0]();
	}
	process.exit(0);
}
process.on('SIGINT', handleWrite);
process.on('SIGTERM', handleWrite);

for (const project of Object.keys(config.projects)) {
	for (const target of config.projects[project]) {
		const translated = {};
		const cache = {};
		const caches = {};
		const overwrites = [];

		for (const file of fs.readdirSync('./translate/cache', 'utf-8')) {
			if (file.endsWith('.'+target+'.json') && file.startsWith(project + '.')) {
				const oldData = JSON.parse(fs.readFileSync('./translate/cache/'+file, 'utf-8'));
				caches[file] = oldData;
				for (const element of Object.keys(oldData)){
					translated[element] = oldData[element];
					cache[element] = oldData[element];
				}
			}
		}

		if (fs.existsSync('./translate/overwrites/'+project+'.json')) {
			const oldData = JSON.parse(fs.readFileSync('./translate/overwrites/'+project+'.json', 'utf-8'));
			for (const element of oldData) {
				overwrites.push(element.from);
				translated[element.from] = element[target] || element.from;
				if (typeof cache[element.from] === 'string') {
					delete cache[element.from];
				}
			}
		}

		for (const file of fs.readdirSync('./translate/from', 'utf-8')) {
			if (file.endsWith('.json') && file.startsWith(project + '.')) {
				const data = JSON.parse(fs.readFileSync('./translate/from/'+file, 'utf-8'));
			
				const out = [];
				const name = file.replace(/.json$/, '.')+target+'.json';
				const fileCache = caches[name] || {};
				const write = () => {
					fs.writeFileSync(
						'./translate/cache/'+name,
						JSON.stringify(fileCache, null, 2),
						'utf-8'
					);
				};

				handler[0] = write;
				handler[1] = false;

				const start = Date.now();
				for (const element of data) {
					const perc = out.length/data.length;
					const remainder = out.length > 0 ? (Date.now() - start)/out.length * data.length/1000 : '';
					console.clear();
					console.log('[   ] '+file+'(en => '+target+') => ' + Math.floor(perc * 10000)/100 + '% ETA '+Math.floor(remainder/3600)+':'+Math.floor(remainder%3600/60)+':'+Math.floor(remainder%60));
					let tryCount = 0;
					if (element.string.length > 2000) {
						translated[element.string] = '@TODO';
					}
					while (typeof translated[element.string] === 'undefined') {
						await delay(tryCount);
						const res = await fetch(baseUrl + "/translate", {
							method: "POST",
							body: JSON.stringify({
								q: element.string,
								source: "en",
								target,
								format: "text",
								alternatives: 0,
								api_key: currentAPIKey,
							}),
							headers: { "Content-Type": "application/json" }
						});
						if (res.status === 200) {
						    translated[element.string] = (await res.json()).translatedText;
						    console.clear();
							console.log('[200] '+file+'(en => '+target+') => ' + Math.floor(perc * 10000)/100 + '% ETA '+Math.floor(remainder/3600)+':'+Math.floor(remainder%3600/60)+':'+Math.floor(remainder%60));
							await wait();
						} else if (res.status === 403) {
							const error = (await res.json()).error;
							if (error === 'Too many request limits violations') {
								console.clear();
								console.log('[403] '+file+'(en => '+target+') => ' + Math.floor(perc * 10000)/100 + '% ETA '+Math.floor(remainder/3600)+':'+Math.floor(remainder%3600/60)+':'+Math.floor(remainder%60));
								await wait(31 + tryCount);
							} else {
								console.error(error);
								process.exit(1);
							}
						} else if (res.status === 429) {
							console.clear();
							console.log('[429] '+file+'(en => '+target+') => ' + Math.floor(perc * 10000)/100 + '% ETA '+Math.floor(remainder/3600)+':'+Math.floor(remainder%3600/60)+':'+Math.floor(remainder%60));
							await wait(7 + tryCount);
						} else {
							console.error(res.status, await res.json());
							process.exit(1);
						}
						tryCount++;
					}
					if (!overwrites.includes(element.string) && (typeof cache[element.string] === 'undefined' || cache[element.string] !== translated[element.string])) {
					    cache[element.string] = translated[element.string];
					    fileCache[element.string] = translated[element.string];
						handler[1] = true;
					}
				    const newEl = {...element};
				    newEl.string = translated[element.string];
					out.push(newEl);
				}
				if (name.includes('.mcm.') && typeof mcmLanguages[target] === 'string') {
					let output = '';
					for (const el of out) {
						output += el.key + '\t' + el.string + '\n';
					}
					fs.writeFileSync(
						'./translate/to/'+name
							.replace(/.mcm./, '.')
							.replace(/.json$/, '.txt')
							.replace('.' + target, '_' + mcmLanguages[target]),
						output,
						'utf-8'
					);
				} else if (!name.includes('.achievements.')) {
					let output = '';
					for (const el of out) {
						output += el.key + '\t' + el.string + '\n';
					}
					fs.writeFileSync(
						'./translate/to/'+name
							.replace(/.achievements./, '.')
							.replace(/.json$/, '.txt')
							.replace('.' + target, '_' + target),
						output,
						'utf-8'
					);
				} else if (!name.includes('.mcm.')) {
					if (!fs.existsSync('./translate/to/' + target)) {
						fs.mkdirSync('./translate/to/' + target);
					}
					fs.writeFileSync(
						'./translate/to/' + target + '/'+file,
						JSON.stringify(out, null, 2),
						'utf-8'
					);
				}

				write();
				handler[0] = () => {};
				handler[1] = false;
			}
		}
	}
}
process.exit(0);
