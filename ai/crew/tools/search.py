"""WebSearchTool — DuckDuckGo-backed web search for agents.

No API key required. Used by all flow agents to research exercise science,
nutrition guidelines, and training methodology in real time.
"""
from __future__ import annotations
from typing import Type
from pydantic import BaseModel, Field
from crewai.tools import BaseTool


class WebSearchInput(BaseModel):
    query: str = Field(description="Search query to look up on the web.")
    max_results: int = Field(default=5, description="Number of results to return (1–10).")


class WebSearchTool(BaseTool):
    name: str = "web_search"
    description: str = (
        "Search the web for current information. Use this to look up exercise science, "
        "sports nutrition research, training methodologies, supplement evidence, injury "
        "management protocols, or any topic where up-to-date external context would "
        "improve your recommendations. Returns numbered results with titles, snippets, "
        "and source URLs. You MUST cite the source URL of any web result you rely on "
        "in your output (e.g. as a markdown link [Title](url))."
    )
    args_schema: Type[BaseModel] = WebSearchInput

    def _run(self, query: str, max_results: int = 5) -> str:
        try:
            from duckduckgo_search import DDGS
            from ai.crew import thoughts
            with DDGS() as ddgs:
                results = list(ddgs.text(query, max_results=max(1, min(max_results, 10))))
            if not results:
                return "No results found for this query."
            # Surface the sources to the UI in real time, as the agent searches.
            run_id = thoughts.current_run_id()
            parts = []
            for i, r in enumerate(results, start=1):
                title = r.get("title", "")
                body = r.get("body", "")
                href = r.get("href", "")
                thoughts.publish_source(run_id, title, href)
                parts.append(f"[{i}] **{title}**\n{body}\nSource: {href}")
            return (
                "\n\n---\n\n".join(parts)
                + "\n\nCite any result you use as a markdown link, e.g. [Title](Source URL)."
            )
        except Exception as e:
            return f"Web search error: {e}"
