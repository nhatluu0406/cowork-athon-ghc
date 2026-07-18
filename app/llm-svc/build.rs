// build.rs: tonic-build code generation for llmsvc.proto

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Generate Rust code from proto/llmsvc.proto
    tonic_build::compile_protos("proto/llmsvc.proto")?;

    Ok(())
}
