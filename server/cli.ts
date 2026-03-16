import { getConfig } from "./config";
import { createApp } from "./index";

const config = getConfig();
const app = createApp({ config });

app.listen(Number(config.port), () => {
  console.log(`AFI server listening on ${config.port}`);
});

