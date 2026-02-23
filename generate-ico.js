const fs = require('fs');
const pngToIco = require('png-to-ico').default;

pngToIco('assets/icon.png')
    .then(buf => {
        fs.writeFileSync('assets/icon.ico', buf);
        console.log('Successfully generated assets/icon.ico');
    })
    .catch(console.error);
