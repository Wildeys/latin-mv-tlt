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
          Translate through a Latin intermediate representation. A rule-based transliterator converts Thaana to one
          canonical romanization, and a single small sequence-to-sequence model translates between that Latin and
          English in both directions, chosen by a task prefix. The model never sees Thaana, so Thaana Unicode and its
          segmentation are removed from its problem entirely. The LLM, if any, only ever sees English.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Architecture</h2>
        <pre className="bg-slate-900 text-slate-100 rounded-xl p-4 text-xs overflow-x-auto">{`Dhivehi → English
  Thaana
  → [rule-based transliterator] → Latin
  → [T5 ONNX q8] → English
       └ dictionary + morphology → word glosses (Breakdown)

English → Dhivehi
  English
  → [T5 ONNX q8] → Latin
  → [rule-based reverse transliterator] → Thaana`}</pre>
        <p className="text-xs text-slate-500">
          One model, two task prefixes, both directions. The transliterator is deterministic and needs no download, so
          the Latin view works before any model has loaded — and it is the same code that normalised the training
          corpus, which is what keeps training-time and inference-time Latin identical.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Research goals</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Test whether a Latin intermediate representation makes a browser-sized model viable for Dhivehi</li>
          <li>Measure translation quality with BLEU and chrF++ on a domain-held-out gold set</li>
          <li>Measure Thaana → Latin → Thaana round-trip stability, which bounds everything downstream</li>
          <li>Demonstrate LLM interoperability without making the LLM the translator</li>
        </ul>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Prior work in this project</h2>
        <p>
          An earlier version translated through an explicit <em>semantic frame</em>: dictionary lookup and morphology
          filled slots for subject, action, object, location, time, tense, polarity and register, and two small
          realization models turned frames back into sentences. It was a genuine attempt at interpretable, controllable
          translation, and it produced the transliterator, dictionary and morphology this version still depends on.
        </p>
        <p>
          It was superseded because coverage was bounded by its slot vocabulary — roughly sixty content words. A
          sentence such as <em>“The parliament passed the amendment yesterday”</em> could not be translated at all, and
          the two models together cost more to download than one model trained on real parallel text. The approach is
          recorded rather than erased; if revived, it would be most defensible as an interpretability overlay on top of
          a direct model rather than as the translation mechanism itself.
        </p>
      </section>
      <section>
        <h2 className="text-lg font-semibold">Limitations</h2>
        <p>
          Coverage is corpus-limited. The model is trained largely on news text, so it is weakest on conversational and
          social-media Dhivehi. Quality is not guaranteed to beat the frame pipeline on the narrow set of sentences that
          pipeline could handle; this version trades peak in-domain quality for open-domain coverage.
        </p>
        <p>
          Fluent output requires the downloaded model. When it is unavailable the translator reports “Unavailable” and
          emits nothing — that is the intended behaviour, not a failure. Transliteration is many-to-one for ten
          Arabic-derived Thaana letters, so a round trip normalises them; the measured rate is on the Benchmarks page.
          Honorifics are recognised, not fully generated. This is a research prototype, not a production MT system.
        </p>
      </section>
    </article>
  );
}
