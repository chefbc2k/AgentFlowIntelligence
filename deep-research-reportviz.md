# Visualizing Agent Flow Intelligence Data for a Fast MVP

## Executive summary

For a hackathon-grade MVP that needs to **explore time-series behavior, compare counterparties, and inspect wallet↔service relationship graphs**, the stack you proposed—**Streamlit + Plotly + Pandas + NetworkX + PyVis (+ scikit-learn)**—is one of the fastest “Python-first” ways to *serve and interact with* the data you’ve been gathering.

The core reasons are practical and evidenced in the official docs: Streamlit has first-class support for **interactive Plotly charts** via `st.plotly_chart`. citeturn0search1 Streamlit also has built-in **caching** (`st.cache_data`, `st.cache_resource`) to protect you from expensive API calls and repeated transforms, which matters a lot when you’re assembling agent behavior views from many upstream sources. citeturn0search0 For graphs, PyVis is explicitly designed for “quick generation … with minimal python code” and produces interactive, browser-native network graphs (drag/hover/select), making it ideal for a first relationship view. citeturn1search0turn1search16 If you later want richer graph UX at scale, Cytoscape.js is a purpose-built interactive graph library for web UIs with a core graph model and renderer, and it’s widely used beyond simple demos. citeturn1search1turn1search5turn1search17

Matplotlib is still useful, but for *this* product feel (interactive exploration, hover/zoom/filter, graph navigation), it is usually not the best default in Streamlit—Streamlit even warns about Matplotlib thread/concurrency issues becoming more prominent when deploying and sharing apps with concurrent users. citeturn2search0

## When this stack is the best path

### It’s the best path for a hackathon MVP if your goal is interactive exploration

If you’re building a product-like cockpit where judges/users can slice by wallet, service endpoint, day/week, and see behavioral deltas quickly, **Streamlit + Plotly** is a strong choice because Streamlit renders Plotly figures as **interactive charts** via `st.plotly_chart` (and requires `plotly>=4.0.0`). citeturn0search1 Plotly’s core value proposition in Python is exactly that: interactive graphs rendered in the browser rather than “static images.” citeturn1search3

### It’s also a good “data serving” path because Streamlit is both UI and backend

Streamlit runs Python server-side. That means:
- You can keep API keys server-side and manage them via Streamlit’s secrets management patterns (`st.secrets` and secrets tooling), rather than exposing credentials in a browser bundle. citeturn0search3turn0search15  
- You can cache upstream pulls and reshaping work using Streamlit caching primitives (`st.cache_data` for serializable data like DataFrames; `st.cache_resource` for shared resources like DB connections or ML models). citeturn0search0  
- You can persist per-user interaction selections across reruns through **Session State**, which is explicitly designed to share variables between reruns and persist across pages in multi-page apps. citeturn2search2turn2search10  

### Multi-page app model maps cleanly to your three-view mental model

Streamlit supports organizing apps into multiple pages with navigation (“multipage apps”), which aligns naturally with:
- Dashboard page (time series + distribution)
- Graph page (relationship visualization)
- Model page (scores/clusters/anomalies) citeturn2search1

## Tool-by-tool evaluation against your Agent Flow Intelligence UI needs

### Streamlit for UI

**Why it works well here:** You need a fast way to build **interactive, stateful, multi-page** exploration around “wallet behavior profiles.” Streamlit provides:
- Multi-page structure. citeturn2search1  
- Session state (per-user selections across reruns/pages). citeturn2search2turn2search10  
- Caching for repeated data pulls/transforms. citeturn0search0  
- A supported way to embed custom HTML/JS in an iframe via `st.components.v1.html`, which is important for PyVis or Cytoscape embeddings. citeturn0search2  

**The key Streamlit constraint to design around:** Streamlit’s execution model reruns top-to-bottom on interactions, so you should centralize expensive steps behind caching and load data incrementally/parameterized (wallet-scoped queries rather than global backfills). Streamlit’s caching APIs are specifically designed to address this pattern. citeturn0search0  

### Plotly for time series, scatter, bars, heatmaps, dashboards

**Why Plotly is the right default for your charts:** Streamlit’s Plotly integration is explicit and first-class: `st.plotly_chart` displays an *interactive* Plotly chart and follows Plotly’s figure API patterns. citeturn0search1 Plotly itself is positioned as an interactive graphing library for Python. citeturn1search3

For your Agent Flow Intelligence screens, Plotly is a good match for:
- tx volume over time (line/area)
- settlement/fulfillment latency distributions (histogram/box)
- counterparties (bar + Pareto-style cum lines)
- burstiness (rolling std/rolling z-score)
- concentration risk (Lorenz-ish curve, top-N share bars)
- reliability bands (facet charts by service/provider)

### Pandas for shaping and precomputing

Pandas remains the fastest way to:
- join heterogeneous API outputs into a single “interaction fact table”
- groupby aggregations for metrics (repeat rate, per-counterparty stats, dormancy windows)
- rolling windows for burst detection
- export filtered slices as “evidence packets” to JSON

(For very large datasets you might later swap in DuckDB/Polars, but for MVP speed, Pandas is appropriate.)

### NetworkX for graph construction and graph analytics

NetworkX is a proven graph analysis library for creating/manipulating graphs and applying many standard network algorithms and measures. citeturn1search2 It makes sense as your server-side layer for building the relationship graph (wallet→counterparty→service→settlement) and computing metrics like:
- degree centrality (counterparty breadth vs dependency)
- connected components (clusters)
- shortest paths (funding flows)
- community detection (optional; may require extra packages)

### PyVis for the **fastest** usable relationship graph view

PyVis is explicitly positioned as “quick generation of visual network graphs with minimal python code” and is a wrapper around the JavaScript vis.js library. citeturn1search0turn1search16 It supports interactive dragging/hovering/selection. citeturn1search16

In a Streamlit MVP, PyVis’ big advantage is: you can generate an HTML network on the server and embed it into your app using Streamlit’s HTML component API. citeturn0search2 That means you get a graph page with real interactivity without building a full JS front-end.

The tradeoff: PyVis is fantastic for “first graph view,” but if you need very rich graph interactions, large graphs, complex event handling, or a very polished browser-first UX, Cytoscape.js usually wins.

### Cytoscape.js for “cleaner web interaction” and long-term UI quality

Cytoscape.js is designed as an interactive graph theory library for building rich graph UIs; its architecture is centered on a “core” graph instance and element collections, supporting programmatic layouts, viewport control, and interaction. citeturn1search1 The project itself frames Cytoscape.js as a graph theory model plus an optional renderer for interactive graphs, designed to be easy to use in apps with a rich UI. citeturn1search5 It is also documented in peer-reviewed literature as a browser-based interactive graph library and even usable headlessly in Node.js for server-side graph operations. citeturn1search17

So your split is directionally right:
- **PyVis** = fastest to something usable in Streamlit
- **Cytoscape.js** = better “product-quality” interactive graph UX (especially with React)

### scikit-learn for “one simple model” (anomaly score or clustering)

For MVP modeling, scikit-learn is an excellent choice because it has mature, drop-in algorithms you can apply directly to engineered features from your behavior layer (burstiness, concentration, latency, failure rate, etc.). For anomaly detection specifically, IsolationForest is a standard baseline; the scikit-learn docs define its API and show example usage for predicting outliers. citeturn2search3

Plotly then becomes the natural way to visualize model outputs:
- anomaly score time series
- top anomalous interactions table
- cluster scatter (e.g., UMAP later, or simple PCA)

## Why “not Matplotlib” is a reasonable default here

The most convincing, repo-relevant reason to avoid Matplotlib as the default in this Streamlit app is operational: Streamlit’s `st.pyplot` documentation explicitly warns that **Matplotlib doesn’t work well with threads**, and that the bug is more prominent when you deploy/share apps because concurrent users are more likely. citeturn2search0

That doesn’t mean “never use Matplotlib,” but it does support your heuristic:
- Matplotlib is fine for quick static summaries or internal notebooks.
- For a multi-user, product-feeling browser experience (hover, zoom, selection, filtering), **Plotly is a better default**—and Streamlit explicitly supports it as an interactive chart element. citeturn0search1

## Recommendation for your Agent Flow Intelligence implementation

### Best MVP visual stack recommendation

For your use case and timeline: **Yes**—**Python + Pandas + Streamlit + Plotly + PyVis** is one of the best paths for the first implementation because it minimizes front-end complexity while delivering:
- interactive dashboards (Plotly in Streamlit) citeturn0search1
- a real relationship graph view with minimal code (PyVis) citeturn1search0turn1search16
- state + caching to keep the app responsive while hitting multiple APIs citeturn0search0turn2search2

### The “upgrade path” that avoids rewrites

Start with PyVis for the graph page (fastest), but structure your graph data as an abstract model (`nodes[]`, `edges[]`, node/edge attributes). Then:
- keep NetworkX for building/analytics
- keep Plotly for charts
- later replace only the renderer with Cytoscape.js (likely via a Streamlit custom component or a React frontend)

Streamlit supports building custom components in JavaScript/HTML when you want a deeper integration than simple HTML iframes. citeturn0search10

## Practical decision rule

Choose **Streamlit + Plotly + PyVis** if:
- you want the MVP in 1–2 days
- you want to iterate fast on metrics and visuals
- you can accept “good enough” graph interactions initially

Move graph rendering to **Cytoscape.js (React)** if:
- you need very large graphs, sophisticated interaction patterns, or a polished long-term UI
- you want fine-grained client-side filtering/layout control

Keep Matplotlib only where it clearly wins:
- static exports, reports, or quick debug charts
- highly customized non-interactive visuals  
…and even then note Streamlit’s matplotlib threading caveat for deployed apps. citeturn2search0