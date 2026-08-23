export default function About() {
  return (
    <article className="prose prose-slate dark:prose-invert max-w-2xl text-sm space-y-4">
      <section>
        <h2 className="text-lg font-semibold">Problem</h2>
        <p>
          Dhivehi has limited NLP resources. Many language models tokenize Thaana poorly or treat it as unknown.
          A reliable offline translator cannot assume a cloud LLM is available.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Research idea</h2>
        <p>
          Translate through a Latin intermediate representation. Dictionary lookup and linguistic analysis extract a
          semantic frame. A small sentence-realization model turns that frame into a sentence. The LLM, if any, only
          ever sees English.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Architecture</h2>
        <pre className="bg-slate-900 text-slate-100 rounded-xl p-4 text-xs overflow-x-auto">{`Thaana
  → Latin
  → Dictionary + morphology
  → Semantic frame
  → Realization model
  → English

English
  → Sentence analysis
  → Semantic frame
  → Map slots to Dhivehi Latin
  → Realization model
  → Latin → Thaana`}</pre>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Research goals</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Test the Latin intermediate representation</li>
          <li>Evaluate translation quality against a gold set</li>
          <li>Compare realization before and after a trained model is loaded</li>
          <li>Demonstrate LLM interoperability without making the LLM the translator</li>
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Limitations</h2>
        <p>
          Frames are lossy. Tokens the extractor cannot classify stay visible as residue rather than disappearing.
          Fluent output requires a downloaded realization model. English analysis is intentionally simpler than the
          Dhivehi side. Honorifics are recognised, not fully generated. This is a research prototype, not a production
          MT system.
        </p>
      </section>
    </article>
  );
}
