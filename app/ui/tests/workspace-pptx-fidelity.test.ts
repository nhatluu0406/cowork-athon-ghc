/**
 * High-fidelity PPTX engine — element-level fidelity check.
 *
 * These tests prove the chosen local engine (@aiden0z/pptx-renderer) actually PARSES the visual
 * elements of a deck — text shapes, images, tables and charts — not merely that a container exists.
 * We drive the engine's browser-free pipeline (parseZip → buildPresentation → serializePresentation)
 * against a fixture .pptx we build in-memory with JSZip, and assert the serialized slide model
 * contains the corresponding node types. Pixel rendering (HTML/SVG) is confirmed separately by
 * packaged Product-Owner acceptance; here we lock in that the element extraction is real.
 */

import "./setup-dom.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import JSZip from "jszip";

// happy-dom parses OOXML (namespaces, querySelector) but lacks Element.lookupNamespaceURI, which the
// engine uses to resolve prefixed attributes (e.g. r:embed). Provide a spec-shaped implementation
// that walks ancestors for the matching xmlns declaration so the browser-free parse tests can run.
const ElementProto = (globalThis as unknown as { Element?: { prototype: Record<string, unknown> } })
  .Element?.prototype;
if (ElementProto && typeof ElementProto["lookupNamespaceURI"] !== "function") {
  ElementProto["lookupNamespaceURI"] = function (this: unknown, prefix: string | null): string | null {
    const attr = prefix ? `xmlns:${prefix}` : "xmlns";
    let node = this as {
      nodeType?: number;
      getAttribute?: (name: string) => string | null;
      parentNode?: unknown;
    } | null;
    while (node && node.nodeType === 1) {
      const value = node.getAttribute?.(attr);
      if (value) return value;
      node = node.parentNode as typeof node;
    }
    return null;
  };
}
import {
  parseZip,
  buildPresentation,
  serializePresentation,
  RECOMMENDED_ZIP_LIMITS,
} from "@aiden0z/pptx-renderer";

const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const C = "http://schemas.openxmlformats.org/drawingml/2006/chart";

// 1x1 transparent PNG.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>`;

const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId3"/></p:sldMasterIdLst>
  <p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;

const presentationRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;

// Slide 1: a text shape + a picture + a table + a chart.
const slide1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7772400" cy="1470025"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Hello Fidelity</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:pic>
        <p:nvPicPr><p:cNvPr id="3" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="838200" y="2000250"/><a:ext cx="2000250" cy="2000250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      </p:pic>
      <p:graphicFrame>
        <p:nvGraphicFramePr><p:cNvPr id="4" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="838200" y="4200000"/><a:ext cx="5000000" cy="1000000"/></p:xfrm>
        <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
          <a:tbl>
            <a:tblPr firstRow="1" bandRow="1"/>
            <a:tblGrid><a:gridCol w="2500000"/><a:gridCol w="2500000"/></a:tblGrid>
            <a:tr h="500000">
              <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>R1C1</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
              <a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>R1C2</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>
            </a:tr>
          </a:tbl>
        </a:graphicData></a:graphic>
      </p:graphicFrame>
      <p:graphicFrame>
        <p:nvGraphicFramePr><p:cNvPr id="5" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
        <p:xfrm><a:off x="838200" y="5300000"/><a:ext cx="5000000" cy="1200000"/></p:xfrm>
        <a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" xmlns:r="${R}" r:id="rId3"/></a:graphicData></a:graphic>
      </p:graphicFrame>
    </p:spTree>
  </p:cSld>
</p:sld>`;

// Slide 2: minimal, one text shape — used to check ordering + count.
const slide2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr/>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7772400" cy="1470025"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;

const slide1Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
</Relationships>`;

const slide2Rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const slideLayout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>
</p:sldLayout>`;

const slideLayoutRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const slideMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
  </p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>`;

const slideMasterRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${A}" name="Office">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;

const chart1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}">
  <c:chart><c:plotArea><c:layout/>
    <c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
      <c:ser><c:idx val="0"/><c:order val="0"/>
        <c:cat><c:strRef><c:f>Sheet1!$A$1:$A$2</c:f><c:strCache><c:ptCount val="2"/><c:pt idx="0"><c:v>A</c:v></c:pt><c:pt idx="1"><c:v>B</c:v></c:pt></c:strCache></c:strRef></c:cat>
        <c:val><c:numRef><c:f>Sheet1!$B$1:$B$2</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="2"/><c:pt idx="0"><c:v>3</c:v></c:pt><c:pt idx="1"><c:v>5</c:v></c:pt></c:numCache></c:numRef></c:val>
      </c:ser>
      <c:axId val="1"/><c:axId val="2"/>
    </c:barChart>
    <c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:crossAx val="2"/></c:catAx>
    <c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:crossAx val="1"/></c:valAx>
  </c:plotArea><c:plotVisOnly val="1"/></c:chart>
</c:chartSpace>`;

async function buildFixturePptx(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", rootRels);
  zip.file("ppt/presentation.xml", presentation);
  zip.file("ppt/_rels/presentation.xml.rels", presentationRels);
  zip.file("ppt/slides/slide1.xml", slide1);
  zip.file("ppt/slides/slide2.xml", slide2);
  zip.file("ppt/slides/_rels/slide1.xml.rels", slide1Rels);
  zip.file("ppt/slides/_rels/slide2.xml.rels", slide2Rels);
  zip.file("ppt/slideLayouts/slideLayout1.xml", slideLayout);
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", slideLayoutRels);
  zip.file("ppt/slideMasters/slideMaster1.xml", slideMaster);
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", slideMasterRels);
  zip.file("ppt/theme/theme1.xml", theme);
  zip.file("ppt/charts/chart1.xml", chart1);
  zip.file("ppt/media/image1.png", PNG_1X1);
  const u8 = await zip.generateAsync({ type: "uint8array" });
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function collectNodeTypes(nodes: { nodeType: string; children?: unknown[] }[]): Set<string> {
  const types = new Set<string>();
  const walk = (list: { nodeType: string; children?: unknown[] }[]): void => {
    for (const n of list) {
      types.add(n.nodeType);
      if (Array.isArray(n.children)) {
        walk(n.children as { nodeType: string; children?: unknown[] }[]);
      }
    }
  };
  walk(nodes);
  return types;
}

test("engine parses a deck into ordered slides at the presentation slide size", async () => {
  const buffer = await buildFixturePptx();
  const files = await parseZip(buffer, RECOMMENDED_ZIP_LIMITS);
  const model = serializePresentation(buildPresentation(files));
  assert.equal(model.slideCount, 2, "both slides are present");
  // The engine normalizes the presentation slide size (9144000 x 6858000 EMU) to CSS px (÷9525).
  assert.equal(model.width, 960, "reads the presentation slide width (960px = 9144000 EMU)");
  assert.equal(model.height, 720, "reads the presentation slide height (720px = 6858000 EMU)");
  assert.equal(model.slides[0]?.index, 0, "slides carry an ordered index");
  assert.equal(model.slides[1]?.index, 1);
});

test("engine extracts real visual elements: text, image, table and chart", async () => {
  const buffer = await buildFixturePptx();
  const files = await parseZip(buffer, RECOMMENDED_ZIP_LIMITS);
  const model = serializePresentation(buildPresentation(files));
  const first = model.slides[0]!;
  const types = collectNodeTypes(first.nodes);

  // A text shape with the authored text.
  const textNodes = first.nodes.filter((n) => n.textBody?.totalText.includes("Hello Fidelity"));
  assert.ok(textNodes.length >= 1, `text shape parsed (node types: ${[...types].join(", ")})`);

  // An image node bound to the embedded media relationship.
  const imageNodes = first.nodes.filter((n) => typeof n.blipEmbed === "string" && n.blipEmbed);
  assert.ok(imageNodes.length >= 1, "picture node parsed with an embedded blip");

  // A table node with rows/cells.
  const tableNodes = first.nodes.filter((n) => Array.isArray(n.rows) && n.rows.length > 0);
  assert.ok(tableNodes.length >= 1, "table node parsed with rows");
  assert.ok(
    tableNodes[0]!.rows!.some((row) => row.cells.some((c) => c.text.includes("R1C1"))),
    "table cell text is extracted",
  );

  // A chart node bound to the chart part.
  const chartNodes = first.nodes.filter((n) => typeof n.chartPath === "string" && n.chartPath);
  assert.ok(chartNodes.length >= 1, "chart node parsed with a chart part reference");
});
