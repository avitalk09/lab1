const button = document.getElementById('test-button');
const output = document.getElementById('output');

let clicks = 0;

button.addEventListener('click', () => {
  clicks++;
  output.textContent = `JavaScript is working. Clicks: ${clicks}`;
});
