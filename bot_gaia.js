'use strict';

import config from "./config.json" with {type: "json"};
import axios from "axios";
import _ from "lodash";
import fs from "fs";
import { performance } from "perf_hooks";
import chalk from "chalk";

// Parse command-line arguments to find a chunk size parameter, defaulting to 1 if not provided
const args = process.argv.slice(2);
const CHUNK_SIZE = parseInt(args.find(arg => arg.startsWith("--chunk-size="))?.split("=")[1], 10) || 1;

// Function to process a returned string from the API response
// This function slices off the first few characters and then replaces certain escaped characters
// to produce a cleaner output string.
const proceedString = async (string) => {
  // Extract the first three characters of the string for comparison
  const resultString = `${string[0]}${string[1]}${string[2]}`;
  const charsCount = [3, 1];

  // Inner function to deeply process the string after slicing it further
  const deepProceedString = (chars) => {
    return string
        .substring(chars, string.length - 1) // Trim off a few characters at the start and end
        .replace(/\\n/g, ' ')                // Replace escaped newlines with spaces
        .replace(/\\n\\n/g, ' ')             // Replace double newlines with a single space
        .replace(/\\"/g, '"')                // Replace escaped quotes with normal quotes
        .replace(/ {2,}/g, " ");             // Replace multiple spaces with a single space
  }

  // If the first three characters match '": ', we remove 3 chars, otherwise we remove only 1.
  return deepProceedString((resultString === '": ') ? charsCount[0] : charsCount[1]);
}

// Function to send a phrase to the remote node (via axios POST request) and process the response
// async function postToNode(phrase) {
//   return new Promise((nodeTaskCompleted, reject) => {
//     return axios.post(config.url, {
//       messages: [
//         { role: "system", content: "You are a helpful assistant." },
//         { role: "user", content: phrase }
//       ]
//     })
//         .then(async (response) => {
//           try {
//             // Convert the response data to JSON string and then process it
//             const string = JSON.stringify(response.data["choices"][0].message.content);
//             const result = await proceedString(string);
//             nodeTaskCompleted(result);
//           } catch (error) {
//             reject(`${error.message}`);
//           }
//         })
//         .catch(error => {
//           // If the request fails, reject the promise with the error message
//           reject(`${error.message}`);
//         });
//   })
// }

async function postToNode(phrase) {
  return new Promise((nodeTaskCompleted, reject) => {
    const url = 'https://0x0aa110d2e3a2f14fc122c849cea06d1bc9ed1c62.gaia.domains/v1/chat/completions';
    const headers = {
      'accept': 'application/json',
      'accept-language': 'ru-UA,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      'content-type': 'text/event-stream',
      'dnt': '1',
      'origin': 'https://www.gaianet.ai',
      'pragma': 'no-cache',
      'priority': 'u=1, i',
      'referer': 'https://www.gaianet.ai/',
      'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'cross-site',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    };
    const data = {
      model: "Qwen2-0.5B-Instruct-Q5_K_M",
      messages: [
        { role: "system", content: "" },
        { role: "user", content: phrase }
      ],
      stream: true,
      stream_options: { include_usage: true },
      user: "0517c630-978a-45b0-9cc1-2d03c8ff6c82"
    };

    axios.post(url, data, { headers })
        .then(async (response) => {
          try {
            // Преобразуем ответ в строку JSON, затем обрабатываем его
            const string = JSON.stringify(response.data.choices?.[0]?.message?.content || '');
            const result = await proceedString(string);
            nodeTaskCompleted(result);
          } catch (error) {
            reject(`${error.message}`);
          }
        })
        .catch(error => {
          // Обработка ошибок запроса
          reject(`${error.message}`);
        });
  });
}

(async () => {
  // Read phrases from a file specified in the config and split them into an array, filtering out empty lines
  const phrasesArray = fs.readFileSync(config.pathToFile)
      .toString()
      .split('\n')
      .filter(line => line.trim() !== '');

  let roundCounter = 0; // Keep track of how many rounds of requests have been made

  // Run infinitely, cycling through the phrases in random chunks
  while (true) {
    // Shuffle the phrases and divide them into chunks of CHUNK_SIZE
    const chunks = _.chunk(_.shuffle(phrasesArray), CHUNK_SIZE);

    // Iterate over each chunk
    for (const chunk of chunks) {
      const chunkStarted = performance.now(); // Start timing this round of requests
      let promises = [];
      roundCounter++;

      // For each phrase in the current chunk, send it to the node and handle the response
      for (const phrase of chunk) {
        promises.push(
            postToNode(phrase)
                .then(result => {
                  // On success, log a success message with part of the input phrase and the resulting output
                  console.info(`[ ${chalk.bold.green('SUCCESS')} ] | ${chalk.white(phrase.slice(0, 30))}... ${chalk.bgGreen.whiteBright('->')} ${chalk.white(result.slice(0, 30))}...`);
                  return result;
                })
                .catch(error => {
                  // On failure, log an error message with details
                  console.error(`[ ${chalk.bold.red('FAIL')} ]    | ${chalk.white(phrase.slice(0, 30))}... ${chalk.bgRed.whiteBright('->')} ${chalk.redBright(error)}`, ``);
                  return null; // Return null so that Promise.all doesn't reject due to a single failure
                })
        );
      }

      // Log the start of the round and the number of requests being sent
      console.info(`${chalk.bgGrey.whiteBright(`>> Round: ${roundCounter} | Requests sent: ${chunk.length}`)}`);
      await Promise.all(promises); // Wait for all requests in this chunk to finish

      // Measure execution time for this chunk
      const chunkFinished = performance.now();
      const elapsed_time = chunkFinished - chunkStarted;
      let elapsed_value = elapsed_time / 1000;

      // Log the end of the round and how long it took
      console.info(`${chalk.bgGrey.whiteBright(`<< Round: ${roundCounter} | Responses received :: ${chunk.length}. Execution time: ${parseFloat(`${elapsed_value.toFixed(2)}`)} seconds\n`)}`);

      // Pause for 2 seconds before processing the next chunk
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
})()
